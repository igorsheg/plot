import { describe, expect, test } from "bun:test";
import { applySnapshot, emptyProjection } from "../src/projection.js";

const snapshotData = (asOfSequence: number, running: readonly unknown[]) => ({
	asOfSequence,
	snapshot: { work: running.map(workRecord), running },
});

const workRecord = (run: unknown) => ({
	workKey: (run as { workKey: string }).workKey,
	sourceId: "source",
	status: "running",
	display: { title: (run as { workKey: string }).workKey },
	currentRunId: (run as { runId: string }).runId,
});

const run = (workKey: string) => ({
	workKey,
	runId: `${workKey}-run`,
	sourceId: "source",
	display: { title: workKey },
});

describe("applySnapshot monotonicity", () => {
	test("a stale snapshot does not overwrite newer event state", () => {
		const live = applySnapshot(
			emptyProjection("s", "wf"),
			snapshotData(20, [run("w1")]),
		);
		expect(live.frontier).toBe(20);
		expect(live.work.has("w1")).toBe(true);
		expect(live.attempts.has("w1-run")).toBe(true);

		const afterStale = applySnapshot(live, snapshotData(10, []));
		expect(afterStale).toBe(live);
		expect(afterStale.frontier).toBe(20);
		expect(afterStale.work.has("w1")).toBe(true);

		const afterFresh = applySnapshot(live, snapshotData(25, []));
		expect(afterFresh.frontier).toBe(25);
		expect(afterFresh.work.size).toBe(0);
		expect(afterFresh.attempts.size).toBe(0);
	});

	test("snapshots without an asOfSequence still apply (initial attach frame)", () => {
		const r = run("w1");
		const applied = applySnapshot(emptyProjection("s", "wf"), {
			snapshot: { work: [workRecord(r)], running: [r] },
		});
		expect(applied.work.has("w1")).toBe(true);
		expect(applied.attempts.has("w1-run")).toBe(true);
	});
});
