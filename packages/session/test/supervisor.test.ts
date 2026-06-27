import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createEventLogStore } from "../src/event-log.js";
import { PlotSupervisor, type PlotInstanceRecord } from "../src/supervisor.js";

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

test("supervisor attach replays event log records after a sequence", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "plot-supervisor-"));
	const eventLog = await createEventLogStore({
		sessionDir: join(cwd, ".plot/sessions"),
		sessionId: "default",
	});
	await eventLog.append({ type: "session_started", payload: {} });
	await eventLog.append({ type: "tick_started", payload: { tickId: 1 } });
	await writeInstances(cwd, [
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
	for await (const record of new PlotSupervisor({ cwd }).attachRecords(
		"instance-1",
		1,
	)) {
		records.push(record);
	}

	expect(records).toHaveLength(1);
	expect(records[0]).toMatchObject({
		kind: "event",
		event: { sequence: 2, type: "tick_started" },
	});
});
