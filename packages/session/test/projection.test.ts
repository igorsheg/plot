import { expect, test } from "bun:test";
import {
	emptyProjection,
	hydrateDashboardProjection,
	serializeDashboardProjection,
} from "../src/projection.js";

test("projection JSON helpers round-trip map fields", () => {
	const projection = emptyProjection("session-1", "workflow");
	const withMaps = {
		...projection,
		work: new Map([
			[
				"work-1",
				{
					workKey: "work-1",
					sourceId: "source-1",
					title: "Work 1",
					labels: [],
					status: "running" as const,
				},
			],
		]),
		attempts: new Map([
			[
				"run-1",
				{
					runId: "run-1",
					workKey: "work-1",
					sourceId: "source-1",
					stage: "working" as const,
					startedAtSeq: 1,
					lastEventSeq: 2,
					turnCount: 1,
					eventCount: 1,
					meaningfulCount: 1,
					toolUpdateCount: 1,
					messageCount: 0,
					activity: "bash",
					activityKind: "run" as const,
					streaming: true,
					lastDisplay: "bash",
					check: "not-run" as const,
					commands: [],
					observations: [],
					streams: {},
					phases: [],
					timeline: [],
					activeTools: new Map([
						["tool-1", { kind: "run" as const, isCheck: false }],
					]),
				},
			],
		]),
	};

	const serialized = serializeDashboardProjection(withMaps);
	expect(serialized.work["work-1"]?.title).toBe("Work 1");
	expect(serialized.attempts["run-1"]?.activeTools?.[0]?.[0]).toBe("tool-1");
	const hydrated = hydrateDashboardProjection(serialized);
	expect(hydrated.work.get("work-1")?.title).toBe("Work 1");
	expect(hydrated.attempts.get("run-1")?.activeTools?.get("tool-1")?.kind).toBe(
		"run",
	);
});
