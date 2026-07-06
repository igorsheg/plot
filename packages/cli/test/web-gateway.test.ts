import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startRunIpcServer } from "@plot/registry/ipc";
import type { RunRecord } from "@plot/registry/record";
import type { RunRegistryRuntime } from "@plot/registry/supervisor";
import {
	runTranscriptResponse,
	startPlotWebGateway,
} from "../src/web-gateway.js";

const writeRuns = async (registryDir: string, runs: readonly RunRecord[]) => {
	await mkdir(registryDir, { recursive: true });
	await writeFile(
		join(registryDir, "runs.json"),
		`${JSON.stringify(runs, null, 2)}\n`,
	);
};

const startTestGateway = async (cwd: string) => {
	const registryDir = await mkdtemp(join(tmpdir(), "plot-runs-"));
	const registry = await startRunIpcServer({
		options: { cwd, runRegistryDir: registryDir },
	});
	const gateway = await startPlotWebGateway({
		cwd,
		registryDir,
		open: false,
	});
	return {
		registryDir,
		gateway,
		stop: async () => {
			gateway.stop();
			registry.server.close();
			await registry.runRegistry.shutdown();
		},
	};
};

describe("Plot web gateway", () => {
	test("serves runs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "online",
					cwd: dir,
					createdAt: new Date().toISOString(),
					lastSeenAt: new Date().toISOString(),
					sessionId: "default",
					workflowName: "workflow",
					cwdName: "project",
					lastSequence: 3,
				},
			]);
			const response = await fetch(new URL("/api/runs", gateway.url));
			const body = (await response.json()) as {
				readonly runs?: unknown[];
			};
			expect(body.runs).toHaveLength(1);
			expect(body.runs?.[0]).toMatchObject({
				id: "run-1",
				lastSequence: 3,
			});
		} finally {
			await stop();
		}
	});

	test("streams run catalog updates as one SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		await writeRuns(registryDir, [
			{
				id: "run-1",
				status: "online",
				cwd: dir,
				createdAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sessionId: "default",
				workflowName: "workflow",
				cwdName: "project",
				lastSequence: 1,
			},
		]);
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), 5_000);
		try {
			const response = await fetch(new URL("/api/runs/events", gateway.url), {
				signal: abort.signal,
			});
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let text = "";
			while (!text.includes('"kind":"runs"')) {
				// eslint-disable-next-line no-await-in-loop -- test reads SSE until the expected event arrives.
				const chunk = await reader.read();
				if (chunk.done) break;
				text += decoder.decode(chunk.value, { stream: true });
			}
			expect(text).toContain("run-1");
		} finally {
			clearTimeout(timeout);
			abort.abort();
			await stop();
		}
	});

	test("run event SSE is live-only", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		await writeRuns(registryDir, [
			{
				id: "run-1",
				status: "online",
				cwd: dir,
				createdAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sessionId: "default",
				workflowName: "workflow",
				cwdName: "project",
				lastSequence: 1,
			},
		]);
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), 5_000);
		try {
			const response = await fetch(
				new URL("/api/runs/run-1/events?after=0", gateway.url),
				{ signal: abort.signal },
			);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			const chunk = await reader.read();
			const text = chunk.done
				? ""
				: decoder.decode(chunk.value, { stream: true });
			expect(text).toContain(": connected");
			expect(text).not.toContain("session_started");
		} finally {
			clearTimeout(timeout);
			abort.abort();
			await stop();
		}
	});

	test("history endpoint pages durable event records", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
				},
			]);
			await mkdir(join(registryDir, "history"), { recursive: true });
			await writeFile(
				join(registryDir, "history", "run-1.jsonl"),
				`${Array.from({ length: 20_001 }, (_, index) =>
					JSON.stringify({
						kind: "session_event",
						sessionId: "session-1",
						sequence: index + 1,
						timestamp: "2026-01-01T00:00:00.000Z",
						event: { type: "session_started" },
					}),
				).join("\n")}\n`,
			);

			const first = await fetch(
				new URL("/api/runs/run-1/history?after=0", gateway.url),
			);
			expect(first.status).toBe(200);
			const body = (await first.json()) as {
				readonly records?: readonly {
					readonly kind?: string;
					readonly event?: { readonly sequence?: number };
				}[];
				readonly truncated?: boolean;
			};
			expect(body.records).toHaveLength(20_000);
			expect(body.records?.[0]?.kind).toBe("event");
			expect(body.records?.[0]?.event?.sequence).toBe(1);
			expect(body.records?.at(-1)?.event?.sequence).toBe(20_000);
			expect(body.truncated).toBe(true);

			const last = await fetch(
				new URL("/api/runs/run-1/history?after=20000", gateway.url),
			);
			const lastBody = (await last.json()) as {
				readonly records?: readonly {
					readonly event?: { readonly sequence?: number };
				}[];
				readonly truncated?: boolean;
			};
			expect(lastBody.records?.map((record) => record.event?.sequence)).toEqual(
				[20_001],
			);
			expect(lastBody.truncated).toBe(false);

			const missing = await fetch(
				new URL("/api/runs/missing/history?after=0", gateway.url),
			);
			expect(missing.status).toBe(404);
		} finally {
			await stop();
		}
	});

	test("projection endpoint replays durable history for stopped runs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
				},
			]);
			await mkdir(join(registryDir, "history"), { recursive: true });
			const events = [
				{
					kind: "session_event",
					sessionId: "session-1",
					sequence: 1,
					timestamp: "2026-01-01T00:00:00.000Z",
					event: { type: "session_started" },
				},
				{
					kind: "session_event",
					sessionId: "session-1",
					sequence: 2,
					timestamp: "2026-01-01T00:00:01.000Z",
					event: {
						type: "attempt_started",
						run: {
							sourceId: "source-1",
							runId: "run-a",
							workKey: "work-1",
							title: "Work 1",
						},
					},
				},
			];
			await writeFile(
				join(registryDir, "history", "run-1.jsonl"),
				`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
			);
			const response = await fetch(
				new URL("/api/runs/run-1/projection", gateway.url),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				readonly replayed?: boolean;
				readonly projection?: {
					readonly frontier?: number;
					readonly work?: Record<string, { readonly title?: string }>;
				};
			};
			expect(body.replayed).toBe(true);
			expect(body.projection?.frontier).toBe(2);
			expect(body.projection?.work?.["work-1"]?.title).toBe("Work 1");
		} finally {
			await stop();
		}
	});

	test("transcript endpoint serves entries via the replayed reference", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			const transcriptFile = join(dir, "transcript.jsonl");
			await writeFile(
				transcriptFile,
				`${JSON.stringify({
					type: "message",
					timestamp: "t1",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "reviewed the diff" }],
					},
				})}\n`,
			);
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
				},
			]);
			await mkdir(join(registryDir, "history"), { recursive: true });
			const events = [
				{
					kind: "session_event",
					sessionId: "session-1",
					sequence: 1,
					timestamp: "2026-01-01T00:00:00.000Z",
					event: {
						type: "attempt_started",
						run: {
							sourceId: "source-1",
							runId: "attempt-1",
							workKey: "work-1",
							title: "Work 1",
						},
					},
				},
				{
					kind: "agent_event",
					sessionId: "session-1",
					sequence: 2,
					timestamp: "2026-01-01T00:00:01.000Z",
					sourceId: "source-1",
					runId: "attempt-1",
					workKey: "work-1",
					event: { type: "plot_transcript", sessionFile: transcriptFile },
				},
			];
			await writeFile(
				join(registryDir, "history", "run-1.jsonl"),
				`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
			);
			const response = await fetch(
				new URL("/api/runs/run-1/attempts/attempt-1/transcript", gateway.url),
			);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				readonly entries?: readonly {
					readonly role?: string;
					readonly text?: string;
				}[];
			};
			expect(body.entries).toHaveLength(1);
			expect(body.entries?.[0]?.text).toBe("reviewed the diff");

			const missing = await fetch(
				new URL("/api/runs/run-1/attempts/nope/transcript", gateway.url),
			);
			expect(missing.status).toBe(404);
		} finally {
			await stop();
		}
	});

	test("projection endpoint is 409 for runs without history", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "online",
					cwd: dir,
					createdAt: new Date().toISOString(),
					lastSeenAt: new Date().toISOString(),
					sessionId: "default",
					workflowName: "workflow",
					lastSequence: 2,
				},
			]);
			const response = await fetch(
				new URL("/api/runs/run-1/projection", gateway.url),
			);
			expect(response.status).toBe(409);
			expect(await response.text()).toContain("run not live");
		} finally {
			await stop();
		}
	});
});

test("transcript falls back to history when the live snapshot lacks the reference", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-web-transcript-"));
	const transcriptFile = join(dir, "transcript.jsonl");
	await writeFile(
		transcriptFile,
		`${JSON.stringify({
			type: "message",
			timestamp: "t1",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "why I did it" }],
			},
		})}\n`,
	);
	const historyDir = join(dir, "history");
	await mkdir(historyDir, { recursive: true });
	await writeFile(
		join(historyDir, "run-1.jsonl"),
		`${[
			{
				kind: "session_event",
				sessionId: "session-1",
				sequence: 1,
				timestamp: "2026-01-01T00:00:00.000Z",
				event: {
					type: "attempt_started",
					run: {
						sourceId: "source-1",
						runId: "attempt-1",
						workKey: "work-1",
						title: "Work 1",
					},
				},
			},
			{
				kind: "agent_event",
				sessionId: "session-1",
				sequence: 2,
				timestamp: "2026-01-01T00:00:01.000Z",
				sourceId: "source-1",
				runId: "attempt-1",
				workKey: "work-1",
				event: { type: "plot_transcript", sessionFile: transcriptFile },
			},
		]
			.map((event) => JSON.stringify(event))
			.join("\n")}\n`,
	);

	const run: RunRecord = {
		id: "run-1",
		status: "online",
		cwd: dir,
		createdAt: "2026-01-01T00:00:00.000Z",
		sessionId: "session-1",
		workflowName: "workflow",
	};
	// A live registry whose snapshot knows the attempt but not the transcript.
	const registry = {
		spawn: async () => run,
		stop: async () => run,
		prune: async () => [],
		list: async () => [run],
		status: async () => run,
		submit: async () =>
			({
				protocol: "plot.session.v3",
				kind: "response",
				id: "req",
				command: "get_snapshot",
				ok: true,
				lastSequence: 2,
				data: {
					snapshot: {
						work: {},
						running: {
							"attempt-1": {
								runId: "attempt-1",
								workKey: "work-1",
								sourceId: "source-1",
							},
						},
					},
					lastSequence: 2,
				},
			}) as Awaited<ReturnType<RunRegistryRuntime["submit"]>>,
		attachRecords: async function* () {},
		shutdown: async () => {},
	};

	const response = await runTranscriptResponse(
		run,
		"attempt-1",
		registry,
		historyDir,
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		readonly entries?: readonly { readonly text?: string }[];
	};
	expect(body.entries?.[0]?.text).toBe("why I did it");
});
