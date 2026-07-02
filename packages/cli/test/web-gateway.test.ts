import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { startRunIpcServer } from "@plot/session/run-ipc";
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

	test("projection endpoint is live-only", async () => {
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
