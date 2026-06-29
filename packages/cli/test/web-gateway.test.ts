import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createFileEventLogStore } from "@plot/session/event-log";
import type { RunRecord } from "@plot/session/run-registry";
import { startPlotWebGateway } from "../src/web-gateway.js";

const writeRuns = async (registryDir: string, runs: readonly RunRecord[]) => {
	await mkdir(registryDir, { recursive: true });
	await writeFile(
		join(registryDir, "runs.json"),
		`${JSON.stringify(runs, null, 2)}\n`,
	);
};

const startTestGateway = async (cwd: string) => {
	const registryDir = await mkdtemp(join(tmpdir(), "plot-runs-"));
	return {
		registryDir,
		gateway: await startPlotWebGateway({
			cwd,
			registryDir,
			open: false,
		}),
	};
};

describe("Plot web gateway", () => {
	test("serves runs", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir } = await startTestGateway(dir);
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
			gateway.stop();
		}
	});

	test("streams run catalog updates as one SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, registryDir } = await startTestGateway(dir);
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
			gateway.stop();
		}
	});

	test("tails run events as SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const sessionDir = join(dir, ".plot/sessions");
		const eventLog = await createFileEventLogStore({
			sessionDir,
			sessionId: "default",
		});
		await eventLog.appendSessionEvent({
			type: "session_started",
			payload: { ok: true },
		});
		const { gateway, registryDir } = await startTestGateway(dir);
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
				sessionDir,
				eventLogPath: eventLog.path,
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
			let text = "";
			while (!text.includes("id: 1")) {
				// eslint-disable-next-line no-await-in-loop -- test reads SSE until the expected event arrives.
				const chunk = await reader.read();
				if (chunk.done) break;
				text += decoder.decode(chunk.value, { stream: true });
			}
			expect(text).toContain("session_started");
		} finally {
			clearTimeout(timeout);
			abort.abort();
			gateway.stop();
		}
	});

	test("serves a projected run snapshot", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const sessionDir = join(dir, ".plot/sessions");
		const eventLog = await createFileEventLogStore({
			sessionDir,
			sessionId: "default",
		});
		await eventLog.appendSessionEvent({ type: "session_started", payload: {} });
		await eventLog.appendSessionEvent({
			type: "session_tick",
			payload: { tickId: 7 },
		});
		const { gateway, registryDir } = await startTestGateway(dir);
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
					sessionDir,
					eventLogPath: eventLog.path,
					lastSequence: 2,
				},
			]);
			const response = await fetch(
				new URL("/api/runs/run-1/projection", gateway.url),
			);
			const body = (await response.json()) as {
				readonly projection?: {
					readonly frontier?: number;
					readonly work?: unknown;
				};
			};
			expect(body.projection?.frontier).toBe(2);
			expect(body.projection?.work).toEqual({});
		} finally {
			gateway.stop();
		}
	});
});
