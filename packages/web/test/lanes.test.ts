import { describe, expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import type {
	CompletedWorkProjection,
	SerializedAgentAttemptProjection,
	WorkItemProjection,
	WorkStatus,
} from "@plot/session/projection";
import type { WebDashboardProjection } from "../src/api.js";
import { deriveLanes, laneSignature } from "../src/lanes.js";

const work = (
	workKey: string,
	status: WorkStatus,
	currentRunId?: string,
): WorkItemProjection => ({
	workKey,
	sourceId: "source-1",
	title: workKey,
	labels: [],
	status,
	...(currentRunId === undefined ? {} : { currentRunId }),
});

const attempt = (
	runId: string,
	workKey: string,
): SerializedAgentAttemptProjection => ({
	runId,
	workKey,
	sourceId: "source-1",
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: 2,
	turnCount: 1,
	eventCount: 1,
	meaningfulCount: 1,
	toolUpdateCount: 0,
	messageCount: 0,
	activity: "editing",
	activityKind: "edit",
	streaming: true,
	lastDisplay: "editing",
	check: "not-run",
	commands: [],
	observations: [],
	streams: {},
	phases: [],
	timeline: [],
});

const completed = (workKey: string): CompletedWorkProjection => ({
	workKey,
	label: workKey,
	status: "done",
	message: "merged",
	atMs: 1000,
});

const projection = (input: {
	readonly work: readonly WorkItemProjection[];
	readonly completed?: readonly CompletedWorkProjection[];
	readonly attempts?: readonly SerializedAgentAttemptProjection[];
}): WebDashboardProjection => ({
	...serializeDashboardProjection(emptyProjection("session-1", "workflow")),
	work: Object.fromEntries(input.work.map((item) => [item.workKey, item])),
	attempts: Object.fromEntries(
		(input.attempts ?? []).map((item) => [item.runId, item]),
	),
	completed: input.completed ?? [],
});

describe("lanes", () => {
	test("groups work by status, joins the current attempt, dedupes completed", () => {
		const lanes = deriveLanes(
			projection({
				work: [
					work("a", "pending"),
					work("w", "waiting"),
					work("b", "running", "run-b"),
					work("c", "blocked"),
					work("d", "done"),
					work("e", "failed"),
				],
				attempts: [attempt("run-b", "b")],
				completed: [completed("d")],
			}),
		);
		expect(lanes.incoming.map((item) => item.work.workKey)).toEqual(["a", "w"]);
		expect(lanes.acting[0]?.attempt?.runId).toBe("run-b");
		expect(lanes.needsYou.map((item) => item.work.workKey)).toEqual(["c"]);
		// "d" appears once (completed record wins); "e" has no completed record.
		expect(
			lanes.done.map((item) =>
				item.kind === "completed" ? item.completed.workKey : item.work.workKey,
			),
		).toEqual(["d", "e"]);
	});

	test("lane signature changes exactly when a work item moves lanes", () => {
		const before = projection({ work: [work("a", "running")] });
		const stillActing = projection({ work: [work("a", "draining")] });
		const moved = projection({ work: [work("a", "blocked")] });
		expect(laneSignature(before)).toBe(laneSignature(stillActing));
		expect(laneSignature(before)).not.toBe(laneSignature(moved));
	});
});
