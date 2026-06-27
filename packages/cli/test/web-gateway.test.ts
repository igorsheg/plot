import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createEventLogStore } from "@plot/session/event-log";
import type { PlotInstanceRecord } from "@plot/session/supervisor";
import { startPlotWebGateway } from "../src/web-gateway.js";

const writeInstances = async (
	cwd: string,
	instances: readonly PlotInstanceRecord[],
) => {
	const dir = join(cwd, ".plot/supervisor");
	await mkdir(dir, { recursive: true });
	await writeFile(
		join(dir, "instances.json"),
		`${JSON.stringify(instances, null, 2)}\n`,
	);
};

describe("Plot web gateway", () => {
	test("serves supervised sessions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const gateway = await startPlotWebGateway({ cwd: dir, open: false });
		try {
			await writeInstances(dir, [
				{
					id: "instance-1",
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
			const response = await fetch(new URL("/api/instances", gateway.url));
			const body = (await response.json()) as {
				readonly instances?: unknown[];
			};
			expect(body.instances).toHaveLength(1);
			expect(body.instances?.[0]).toMatchObject({
				id: "instance-1",
				lastSequence: 3,
			});
		} finally {
			gateway.stop();
		}
	});

	test("tails supervised session events as SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const eventLog = await createEventLogStore({
			sessionDir: join(dir, ".plot/sessions"),
			sessionId: "default",
		});
		await eventLog.append({ type: "session_started", payload: { ok: true } });
		const gateway = await startPlotWebGateway({ cwd: dir, open: false });
		await writeInstances(dir, [
			{
				id: "instance-1",
				status: "online",
				cwd: dir,
				createdAt: new Date().toISOString(),
				lastSeenAt: new Date().toISOString(),
				sessionId: "default",
				workflowName: "workflow",
				cwdName: "project",
				sessionDir: eventLog.sessionPath,
				eventLogPath: eventLog.eventLogPath,
				lastSequence: 1,
			},
		]);
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), 5_000);
		try {
			const response = await fetch(
				new URL("/api/instances/instance-1/events?after=0", gateway.url),
				{ signal: abort.signal },
			);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let text = "";
			while (!text.includes("id: 1")) {
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

	test("serves a projected supervised session snapshot", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const eventLog = await createEventLogStore({
			sessionDir: join(dir, ".plot/sessions"),
			sessionId: "default",
		});
		await eventLog.append({ type: "session_started", payload: {} });
		await eventLog.append({ type: "session_tick", payload: { tickId: 7 } });
		const gateway = await startPlotWebGateway({ cwd: dir, open: false });
		try {
			await writeInstances(dir, [
				{
					id: "instance-1",
					status: "online",
					cwd: dir,
					createdAt: new Date().toISOString(),
					lastSeenAt: new Date().toISOString(),
					sessionId: "default",
					workflowName: "workflow",
					cwdName: "project",
					sessionDir: eventLog.sessionPath,
					eventLogPath: eventLog.eventLogPath,
					lastSequence: 2,
				},
			]);
			const response = await fetch(
				new URL("/api/instances/instance-1/projection", gateway.url),
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
