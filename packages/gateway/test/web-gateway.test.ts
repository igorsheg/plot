import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import { startRunIpcServer } from "@plot/registry/ipc";
import type { RunRecord } from "@plot/registry/record";
import {
	sessionProtocolVersion,
	type ServerRecord,
} from "@plot/session/protocol";
import type { RuntimeEvent } from "@plot/session/runtime";
import {
	gaplessRunEventRecords,
	runTranscriptResponse,
	startPlotWebGateway,
} from "../src/gateway.js";

const writeRuns = async (registryDir: string, runs: readonly RunRecord[]) => {
	await mkdir(registryDir, { recursive: true });
	await writeFile(
		join(registryDir, "runs.json"),
		`${JSON.stringify(runs, null, 2)}\n`,
	);
};

const writeSessionEvents = async (
	path: string,
	events: readonly unknown[],
): Promise<void> => {
	await writeFile(
		path,
		`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
	);
};

type EventServerRecord = Extract<ServerRecord, { readonly kind: "event" }>;
type SessionRuntimeEvent = Extract<
	RuntimeEvent,
	{ readonly kind: "session_event" }
>;

const serverEvent = (
	sequence: number,
	event: SessionRuntimeEvent["event"],
): EventServerRecord => ({
	protocol: sessionProtocolVersion,
	kind: "event",
	event: {
		kind: "session_event",
		sessionId: "session-1",
		sequence,
		timestamp: "2026-01-01T00:00:00.000Z",
		event,
	},
});

const runtimeEvent = (
	sequence: number,
	event: SessionRuntimeEvent["event"],
): EventServerRecord["event"] => serverEvent(sequence, event).event;

const collectRecords = async (
	records: AsyncIterable<ServerRecord>,
): Promise<readonly ServerRecord[]> => {
	const collected: ServerRecord[] = [];
	for await (const record of records) collected.push(record);
	return collected;
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

test("gapless run records replay durable events after the frontier", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-gapless-"));
	const sessionFile = join(dir, "session-1.jsonl");
	await writeSessionEvents(sessionFile, [
		runtimeEvent(1, { type: "session_started" }),
		runtimeEvent(2, { type: "session_shutdown" }),
	]);
	const live = new AsyncQueue<ServerRecord>();
	live.close();

	const records = await collectRecords(
		gaplessRunEventRecords({ sessionFile, after: 1, liveRecords: live }),
	);
	expect(
		records.map((record) => record.kind === "event" && record.event.sequence),
	).toEqual([2]);
});

test("gapless run records suppress durable/live duplicate sequences", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-gapless-"));
	const sessionFile = join(dir, "session-1.jsonl");
	await writeSessionEvents(sessionFile, [
		runtimeEvent(1, { type: "session_started" }),
		runtimeEvent(2, { type: "session_shutdown" }),
	]);
	const live = new AsyncQueue<ServerRecord>();
	live.offer(serverEvent(2, { type: "session_shutdown" }), { force: true });
	live.offer(serverEvent(3, { type: "session_shutdown" }), { force: true });
	live.close();

	const records = await collectRecords(
		gaplessRunEventRecords({ sessionFile, after: 1, liveRecords: live }),
	);
	expect(
		records.map((record) => record.kind === "event" && record.event.sequence),
	).toEqual([2, 3]);
});

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

	test("run event SSE catches up from the session event log", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		const sessionFile = join(dir, "session-1.jsonl");
		await writeRuns(registryDir, [
			{
				id: "run-1",
				status: "online",
				cwd: dir,
				createdAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sessionId: "session-1",
				workflowName: "workflow",
				cwdName: "project",
				lastSequence: 1,
				sessionFile,
			},
		]);
		await writeSessionEvents(sessionFile, [
			{
				kind: "session_event",
				sessionId: "session-1",
				sequence: 1,
				timestamp: "2026-01-01T00:00:00.000Z",
				event: { type: "session_started" },
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
			let text = "";
			while (!text.includes("session_started")) {
				// eslint-disable-next-line no-await-in-loop -- test reads SSE until durable catch-up arrives.
				const chunk = await reader.read();
				if (chunk.done) break;
				text += decoder.decode(chunk.value, { stream: true });
			}
			expect(text).toContain(": connected");
			expect(text).toContain("session_started");
		} finally {
			clearTimeout(timeout);
			abort.abort();
			await stop();
		}
	});

	test("session-events endpoint pages durable event records", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			const sessionFile = join(dir, "session-1.jsonl");
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
					sessionFile,
				},
			]);
			await writeSessionEvents(
				sessionFile,
				Array.from({ length: 20_001 }, (_, index) => ({
					kind: "session_event",
					sessionId: "session-1",
					sequence: index + 1,
					timestamp: "2026-01-01T00:00:00.000Z",
					event: { type: "session_started" },
				})),
			);

			const first = await fetch(
				new URL("/api/runs/run-1/session-events?after=0", gateway.url),
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
				new URL("/api/runs/run-1/session-events?after=20000", gateway.url),
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
				new URL("/api/runs/missing/session-events?after=0", gateway.url),
			);
			expect(missing.status).toBe(404);
		} finally {
			await stop();
		}
	});

	test("projection endpoint replays the session event log", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			const sessionFile = join(dir, "session-1.jsonl");
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
					sessionFile,
				},
			]);
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
			await writeSessionEvents(sessionFile, events);
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
			expect(body.replayed).toBeUndefined();
			expect(body.projection?.frontier).toBe(2);
			expect(body.projection?.work?.["work-1"]?.title).toBe("Work 1");
		} finally {
			await stop();
		}
	});

	test("transcript endpoint serves entries via the session event log", async () => {
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
			const sessionFile = join(dir, "session-1.jsonl");
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "stopped",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
					sessionFile,
				},
			]);
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
			await writeSessionEvents(sessionFile, events);
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

	test("projection endpoint is 409 for runs without a session event log", async () => {
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
			expect(await response.text()).toContain("no session event log");
		} finally {
			await stop();
		}
	});

	test("run event SSE is 409 without a session event log", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir, stop } = await startTestGateway(dir);
		try {
			await writeRuns(registryDir, [
				{
					id: "run-1",
					status: "online",
					cwd: dir,
					createdAt: new Date().toISOString(),
					sessionId: "session-1",
					workflowName: "workflow",
				},
			]);
			const response = await fetch(
				new URL("/api/runs/run-1/events?after=0", gateway.url),
			);
			expect(response.status).toBe(409);
			expect(await response.text()).toContain("no session event log");
		} finally {
			await stop();
		}
	});
});

test("transcript response reads the session event log reference", async () => {
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
	const sessionFile = join(dir, "session-1.jsonl");
	await writeSessionEvents(sessionFile, [
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
	]);

	const run: RunRecord = {
		id: "run-1",
		status: "online",
		cwd: dir,
		createdAt: "2026-01-01T00:00:00.000Z",
		sessionId: "session-1",
		workflowName: "workflow",
		sessionFile,
	};

	const response = await runTranscriptResponse(run, "attempt-1");
	expect(response.status).toBe(200);
	const body = (await response.json()) as {
		readonly entries?: readonly { readonly text?: string }[];
	};
	expect(body.entries?.[0]?.text).toBe("why I did it");
});
