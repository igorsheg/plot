import { expect, test } from "bun:test";
import {
	applySnapshot,
	emptyProjection,
	hydrateDashboardProjection,
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

test("projection caps token throughput samples", () => {
	let projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		{
			kind: "session_event",
			sessionId: "session-1",
			sequence: 1,
			timestamp: "2026-06-29T10:00:00.000Z",
			type: "attempt_started",
			payload: {
				run: { runId: "run-1", workKey: "work-1", sourceId: "source-1" },
			},
		},
	);
	for (let i = 0; i < 130; i++)
		projection = reduceProjectableEvent(projection, {
			kind: "agent_event",
			sessionId: "session-1",
			sequence: i + 2,
			timestamp: "2026-06-29T10:00:00.000Z",
			runId: "run-1",
			event: {
				type: "message_end",
				message: { responseId: `response-${i}`, usage: { totalTokens: 1 } },
			},
		});

	expect(projection.tokenSamples).toHaveLength(120);
	expect(projection.tokenSamples[0]?.tokens).toBe(11);
	expect(projection.tokenSamples.at(-1)?.tokens).toBe(130);
});

test("projection hydration ignores malformed active tool entries", () => {
	const projection = emptyProjection("session-1", "workflow");
	const hydrated = hydrateDashboardProjection({
		...projection,
		work: {},
		attempts: {
			"run-1": {
				runId: "run-1",
				workKey: "work-1",
				sourceId: "source-1",
				stage: "working",
				startedAtSeq: 1,
				lastEventSeq: 1,
				turnCount: 0,
				eventCount: 0,
				meaningfulCount: 0,
				toolUpdateCount: 0,
				messageCount: 0,
				activity: "running",
				activityKind: "run",
				streaming: true,
				lastDisplay: "running",
				check: "running",
				commands: [],
				observations: [],
				streams: {},
				phases: [],
				timeline: [],
				activeTools: [
					"bad",
					["tool-1", { kind: "run", isCheck: true }],
				] as never,
			},
		},
	});

	expect(hydrated.attempts.get("run-1")?.activeTools?.size).toBe(1);
	expect(hydrated.attempts.get("run-1")?.activeTools?.get("tool-1")?.kind).toBe(
		"run",
	);
});

test("malformed event sequence does not poison the projection frontier", () => {
	const projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		{
			kind: "session_event",
			sessionId: "session-1",
			timestamp: "2026-06-29T10:00:00.000Z",
			type: "session_started",
		},
	);

	expect(projection.status).toBe("running");
	expect(projection.frontier).toBe(0);
});

test("completed work keeps source display labels", () => {
	const base = emptyProjection("session-1", "workflow");
	const started = reduceProjectableEvent(base, {
		kind: "session_event",
		sessionId: "session-1",
		sequence: 1,
		timestamp: "2026-06-29T10:00:00.000Z",
		type: "attempt_started",
		payload: {
			run: {
				runId: "run-1",
				workKey: "work-1",
				sourceId: "source-1",
				display: { title: "Work 1", labels: ["done"] },
			},
		},
	});
	const completed = reduceProjectableEvent(started, {
		kind: "session_event",
		sessionId: "session-1",
		sequence: 2,
		timestamp: "2026-06-29T10:00:01.000Z",
		type: "attempt_completed",
		payload: {
			completion: {
				runId: "run-1",
				workKey: "work-1",
				status: "succeeded",
			},
		},
	});

	expect(completed.completed[0]?.labels).toEqual(["done"]);
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
