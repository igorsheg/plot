import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createFileEventLogStore } from "@plot/session/event-log";
import type { FleetInstanceRecord } from "@plot/session/fleet";
import { startPlotWebGateway } from "../src/web-gateway.js";

const writeInstances = async (
	fleetDir: string,
	instances: readonly FleetInstanceRecord[],
) => {
	await mkdir(fleetDir, { recursive: true });
	await writeFile(
		join(fleetDir, "instances.json"),
		`${JSON.stringify(instances, null, 2)}\n`,
	);
};

const startTestGateway = async (cwd: string) => {
	const fleetDir = await mkdtemp(join(tmpdir(), "plot-fleet-"));
	return {
		fleetDir,
		gateway: await startPlotWebGateway({ cwd, fleetDir, open: false }),
	};
};

describe("Plot web gateway", () => {
	test("serves fleet sessions", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const { gateway, fleetDir } = await startTestGateway(dir);
		try {
			await writeInstances(fleetDir, [
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

	test("tails fleet session events as SSE", async () => {
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
		const { gateway, fleetDir } = await startTestGateway(dir);
		await writeInstances(fleetDir, [
			{
				id: "instance-1",
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

	test("serves a projected fleet session snapshot", async () => {
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
		const { gateway, fleetDir } = await startTestGateway(dir);
		try {
			await writeInstances(fleetDir, [
				{
					id: "instance-1",
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
