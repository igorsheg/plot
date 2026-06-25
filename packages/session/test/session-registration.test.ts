import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	plotSessionRegistrationKey,
	plotSessionRegistrationPath,
	readLivePlotSessionRegistrations,
	resolvePlotSessionDiscoveryDir,
	writePlotSessionRegistration,
} from "../src/session-registration.js";

const registration = (discoveryDir: string, cwd: string) => {
	const key = plotSessionRegistrationKey({ cwd, sessionId: "default" });
	return {
		version: 1 as const,
		key,
		sessionId: "default",
		workflowName: "workflow",
		workflowPath: join(cwd, "WORKFLOW.md"),
		cwd,
		cwdName: cwd.split("/").at(-1) ?? "project",
		sessionDir: join(cwd, ".plot/sessions/default"),
		eventLogPath: join(cwd, ".plot/sessions/default/events.jsonl"),
		pid: process.pid,
		startedAt: "2026-01-01T00:00:00.000Z",
		heartbeatAt: "2026-01-01T00:00:01.000Z",
		lastSequence: 1,
		discoveryDir,
	};
};

describe("Plot session registration", () => {
	test("uses one file per project session", async () => {
		const discoveryDir = await mkdtemp(join(tmpdir(), "plot-discovery-"));
		const one = registration(discoveryDir, "/repo/one");
		const two = registration(discoveryDir, "/repo/two");
		await writePlotSessionRegistration({ discoveryDir, registration: one });
		await writePlotSessionRegistration({ discoveryDir, registration: two });

		const live = await readLivePlotSessionRegistrations({
			discoveryDir,
			nowMs: Date.parse("2026-01-01T00:00:02.000Z"),
		});

		expect(live.map((item) => item.cwd).toSorted()).toEqual([
			"/repo/one",
			"/repo/two",
		]);
		expect(
			JSON.parse(
				await readFile(
					plotSessionRegistrationPath({ discoveryDir, key: one.key }),
					"utf8",
				),
			),
		).toMatchObject({ version: 1, cwd: "/repo/one" });
	});

	test("keeps pid-live sessions even when heartbeat is stale", async () => {
		const discoveryDir = await mkdtemp(join(tmpdir(), "plot-discovery-"));
		const cwd = "/repo/stale-heartbeat";
		await writePlotSessionRegistration({
			discoveryDir,
			registration: registration(discoveryDir, cwd),
		});

		const live = await readLivePlotSessionRegistrations({
			discoveryDir,
			nowMs: Date.parse("2026-01-01T00:10:00.000Z"),
		});

		expect(live.map((item) => item.cwd)).toEqual([cwd]);
	});

	test("stores discovery beside the agent state", () => {
		expect(
			resolvePlotSessionDiscoveryDir({ agentDir: "/home/me/.plot/agent" }),
		).toBe("/home/me/.plot/discovery");
	});
});
