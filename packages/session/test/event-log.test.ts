import { mkdtemp, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createEventLogStore } from "../src/event-log.js";

const tempSessionDir = () => mkdtemp(join(tmpdir(), "plot-event-log-"));

const run = {
	runId: "run-1",
	sourceId: "source",
	workKey: "work:1",
	display: { primary: "#1", title: "Check event log" },
};

describe("Event Log", () => {
	test("appends JSONL with monotonic sequence", async () => {
		const store = await createEventLogStore({
			sessionDir: await tempSessionDir(),
			sessionId: "session-1",
			epoch: "epoch-1",
		});

		const first = await store.append({ type: "session_started" });
		const second = await store.append({
			type: "attempt_started",
			payload: { run },
		});
		const third = await store.append({
			type: "agent_run_event",
			payload: {
				...run,
				eventType: "tool_execution_start",
				event: { type: "tool_execution_start", command: "bun run check" },
			},
		});

		expect([first.sequence, second.sequence, third.sequence]).toEqual([
			1, 2, 3,
		]);
		expect((await store.frontier()).lastSequence).toBe(3);
		expect(
			(await store.readAll()).events.map((event) => event.sequence),
		).toEqual([1, 2, 3]);

		await appendFile(store.eventLogPath, "{ partial", "utf8");
		const read = await store.readAll();
		expect(read.events).toHaveLength(3);
		expect(read.diagnostics[0]?.message).toContain("ignored corrupt final");
	});
});
