import { mkdtemp, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createSessionHistoryStore } from "../src/session-history.js";

const tempSessionDir = () => mkdtemp(join(tmpdir(), "plot-history-"));

const run = {
	runId: "run-1",
	sourceId: "source",
	workKey: "work:1",
	display: { primary: "#1", title: "Check history" },
};

describe("Session History", () => {
	test("appends JSONL with monotonic sequence and replays after a cursor", async () => {
		const store = await createSessionHistoryStore({
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
			(await store.replayAfter(1)).events.map((event) => event.sequence),
		).toEqual([2, 3]);

		await appendFile(store.historyPath, "{ partial", "utf8");
		const read = await store.readAll();
		expect(read.events).toHaveLength(3);
		expect(read.diagnostics[0]?.message).toContain("ignored corrupt final");
	});

	test("rebuilds dashboard projection from persisted Session History", async () => {
		const sessionDir = await tempSessionDir();
		const writer = await createSessionHistoryStore({
			sessionDir,
			sessionId: "session-1",
			epoch: "epoch-1",
		});
		await writer.append({ type: "attempt_started", payload: { run } });
		await writer.append({
			type: "agent_run_event",
			payload: {
				...run,
				eventType: "tool_execution_start",
				event: { type: "tool_execution_start", command: "bun run check" },
			},
		});
		await writer.append({
			type: "attempt_completed",
			payload: {
				completion: {
					...run,
					status: "succeeded",
				},
			},
		});

		const reader = await createSessionHistoryStore({
			sessionDir,
			sessionId: "session-1",
			epoch: "epoch-2",
		});
		const rebuilt = await reader.rebuildDashboardProjection({
			workflowName: "workflow",
		});

		expect(rebuilt.projection.frontier).toBe(3);
		expect(rebuilt.projection.completed[0]).toMatchObject({
			workKey: "work:1",
			label: "#1 Check history",
			status: "succeeded",
		});
		expect(rebuilt.projection.attempts.size).toBe(0);
		expect(rebuilt.projection.work.size).toBe(0);
	});
});
