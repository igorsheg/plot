import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createEventLogStore } from "../src/event-log.js";
import { resolvePlotSupervisorSocketPath } from "../src/plot-paths.js";
import { PlotSupervisor, type PlotInstanceRecord } from "../src/supervisor.js";

const writeInstances = async (
	supervisorDir: string,
	instances: readonly PlotInstanceRecord[],
) => {
	await mkdir(supervisorDir, { recursive: true });
	await writeFile(
		join(supervisorDir, "instances.json"),
		`${JSON.stringify(instances, null, 2)}\n`,
	);
};

test("supervisor socket is machine-global, not project-scoped", async () => {
	const supervisorDir = await mkdtemp(
		join(tmpdir(), "plot-supervisor-global-"),
	);
	expect(resolvePlotSupervisorSocketPath({ supervisorDir })).toBe(
		resolvePlotSupervisorSocketPath({ supervisorDir }),
	);
});

test("supervisor attach replays event log records after a sequence", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-supervisor-project-"));
	const supervisorDir = await mkdtemp(
		join(tmpdir(), "plot-supervisor-global-"),
	);
	const eventLog = await createEventLogStore({
		sessionDir: join(cwd, ".plot/sessions"),
		sessionId: "default",
	});
	await eventLog.append({ type: "session_started", payload: {} });
	await eventLog.append({ type: "tick_started", payload: { tickId: 1 } });
	await writeInstances(supervisorDir, [
		{
			id: "instance-1",
			status: "stopped",
			cwd,
			createdAt: "2026-01-01T00:00:00.000Z",
			sessionId: "default",
			eventLogPath: eventLog.eventLogPath,
		},
	]);

	const records = [];
	for await (const record of new PlotSupervisor({
		cwd,
		supervisorDir,
	}).attachRecords("instance-1", 1)) {
		records.push(record);
	}

	expect(records).toHaveLength(1);
	expect(records[0]).toMatchObject({
		kind: "event",
		event: { sequence: 2, type: "tick_started" },
	});
});
