import { expect, test } from "bun:test";
import type { RuntimeEvent } from "@plot/session/runtime";
import {
	applySnapshot,
	emptyProjection,
	hydrateDashboardProjection,
	parseSerializedDashboardProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
} from "../src/projection.js";

const sessionEvent = (
	sequence: number,
	event: Extract<RuntimeEvent, { kind: "session_event" }>["event"],
): RuntimeEvent => ({
	kind: "session_event",
	sessionId: "session-1",
	sequence,
	timestamp: "2026-06-29T10:00:00.000Z",
	event,
});

const agentEvent = (
	sequence: number,
	runId: string,
	event: unknown,
): RuntimeEvent => ({
	kind: "agent_event",
	sessionId: "session-1",
	sequence,
	timestamp: "2026-06-29T10:00:00.000Z",
	sourceId: "source-1",
	runId,
	workKey: "work-1",
	event,
});

test("projection parser accepts a serialized projection envelope", () => {
	const projection = serializeDashboardProjection(
		emptyProjection("session-1", "workflow", {
			cwd: "/repo",
			cwdName: "repo",
			workflowPath: "/repo/WORKFLOW.md",
			skills: [],
			skillPaths: [],
		}),
	);
	const parsed = parseSerializedDashboardProjection({ projection });
	expect(parsed?.sessionId).toBe("session-1");
	expect(parsed?.runtime.cwdName).toBe("repo");
});

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
		sessionEvent(1, {
			type: "attempt_started",
			run: { runId: "run-1", workKey: "work-1", sourceId: "source-1" },
		}),
	);
	for (let i = 0; i < 130; i++)
		projection = reduceProjectableEvent(
			projection,
			agentEvent(i + 2, "run-1", {
				type: "message_end",
				message: { responseId: `response-${i}`, usage: { totalTokens: 1 } },
			}),
		);

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

test("completed work keeps source display labels", () => {
	const base = emptyProjection("session-1", "workflow");
	const started = reduceProjectableEvent(
		base,
		sessionEvent(1, {
			type: "attempt_started",
			run: {
				runId: "run-1",
				workKey: "work-1",
				sourceId: "source-1",
				display: { title: "Work 1", labels: ["done"] },
			},
		}),
	);
	const completed = reduceProjectableEvent(
		started,
		sessionEvent(2, {
			type: "attempt_completed",
			completion: {
				runId: "run-1",
				workKey: "work-1",
				sourceId: "source-1",
				status: "succeeded",
			},
		}),
	);

	expect(completed.completed[0]?.labels).toEqual(["done"]);
});

test("debug events name agent event payloads", () => {
	const projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		agentEvent(1, "run-1", { type: "turn_start" }),
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

test("attempt timeline is a rolling tail, not a frozen head", () => {
	let projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		sessionEvent(1, {
			type: "attempt_started",
			run: { runId: "run-1", workKey: "work-1", sourceId: "source-1" },
		}),
	);
	for (let i = 0; i < 40; i++)
		projection = reduceProjectableEvent(
			projection,
			agentEvent(i + 2, "run-1", {
				type: "tool_execution_start",
				toolCallId: `tool-${i}`,
				toolName: "bash",
				args: { command: `step-${i}` },
			}),
		);

	const timeline = projection.attempts.get("run-1")?.timeline ?? [];
	expect(timeline).toHaveLength(30);
	expect(timeline.at(-1)?.text).toContain("step-39");
});

test("plot_transcript agent event attaches the transcript reference", () => {
	let projection = reduceProjectableEvent(
		emptyProjection("session-1", "workflow"),
		sessionEvent(1, {
			type: "attempt_started",
			run: { runId: "run-1", workKey: "work-1", sourceId: "source-1" },
		}),
	);
	projection = reduceProjectableEvent(
		projection,
		agentEvent(2, "run-1", {
			type: "plot_transcript",
			sessionFile: "/tmp/transcript.jsonl",
			sessionId: "pi-1",
		}),
	);
	expect(projection.attempts.get("run-1")?.transcript).toEqual({
		path: "/tmp/transcript.jsonl",
		id: "pi-1",
	});
});
