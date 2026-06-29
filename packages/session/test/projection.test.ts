import { expect, test } from "bun:test";
import {
	applySnapshot,
	emptyProjection,
	hydrateDashboardProjection,
	rebuildProjectionFromEventLog,
	reduceProjectableEvent,
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

test("debug events name agent event payloads", () => {
	const projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		{
			kind: "agent_event",
			sessionId: "session-1",
			sequence: 1,
			timestamp: "2026-06-29T10:00:00.000Z",
			runId: "run-1",
			event: { type: "turn_start" },
		},
	);

	expect(projection.debugEvents[0]).toBe("1 agent_event:turn_start");
});

test("snapshot clears stale current run ids", () => {
	const live = {
		...emptyProjection("session-1", "workflow"),
		work: new Map([
			[
				"work-1",
				{
					workKey: "work-1",
					sourceId: "source-1",
					title: "Work 1",
					labels: [],
					status: "running" as const,
					currentRunId: "run-1",
				},
			],
		]),
	};

	const repaired = applySnapshot(live, {
		asOfSequence: 2,
		snapshot: {
			work: {
				"work-1": {
					workKey: "work-1",
					sourceId: "source-1",
					status: "done",
					display: { title: "Work 1" },
				},
			},
			running: {},
		},
	});

	expect(repaired.work.get("work-1")?.status).toBe("done");
	expect(repaired.work.get("work-1")?.currentRunId).toBeUndefined();
	expect(repaired.attempts.size).toBe(0);
});

test("session_started starts a fresh live projection window", () => {
	const projection = rebuildProjectionFromEventLog(
		[
			{
				kind: "session_event",
				sessionId: "session-1",
				sequence: 1,
				timestamp: "2026-06-29T10:00:00.000Z",
				type: "attempt_started",
				payload: { run: { runId: "run-0", workKey: "work-1" } },
			},
			{
				kind: "agent_event",
				sessionId: "session-1",
				sequence: 2,
				timestamp: "2026-06-29T10:00:01.000Z",
				runId: "run-0",
				event: {
					type: "turn_end",
					message: { usage: { totalTokens: 123, cost: { total: 0.45 } } },
				},
			},
			{
				kind: "session_event",
				sessionId: "session-1",
				sequence: 3,
				timestamp: "2026-06-29T10:01:00.000Z",
				type: "session_started",
			},
		],
		emptyProjection("session-1", "workflow"),
	);

	expect(projection.usageTotals).toEqual({ tokens: 0 });
	expect(projection.attempts.size).toBe(0);
	expect(projection.work.size).toBe(0);
	expect(projection.status).toBe("running");
});
