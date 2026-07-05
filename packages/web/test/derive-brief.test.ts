import { describe, expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import type {
	CompletedWorkProjection,
	ScheduledWakeProjection,
	SerializedAgentAttemptProjection,
	WorkItemProjection,
	WorkStatus,
} from "@plot/session/projection";
import type { WebDashboardProjection } from "../src/api.js";
import { deriveBrief } from "../src/derive-brief.js";

const work = (
	workKey: string,
	status: WorkStatus,
	input: Partial<WorkItemProjection> = {},
): WorkItemProjection => ({
	workKey,
	sourceId: "source-1",
	title: workKey,
	labels: [],
	status,
	...input,
});

const completed = (
	workKey: string,
	status = "done",
	atMs = 1000,
): CompletedWorkProjection => ({
	workKey,
	label: workKey,
	status,
	message: "settled",
	atMs,
});

const attempt = (
	runId: string,
	workKey: string,
	lastEventAtMs: number,
): SerializedAgentAttemptProjection => ({
	runId,
	workKey,
	sourceId: "source-1",
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: 2,
	lastEventAtMs,
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

const projection = (input: {
	readonly work?: readonly WorkItemProjection[];
	readonly completed?: readonly CompletedWorkProjection[];
	readonly attempts?: readonly SerializedAgentAttemptProjection[];
	readonly scheduledWakes?: readonly ScheduledWakeProjection[];
}): WebDashboardProjection => ({
	...serializeDashboardProjection(emptyProjection("session-1", "workflow")),
	work: Object.fromEntries(
		(input.work ?? []).map((item) => [item.workKey, item]),
	),
	attempts: Object.fromEntries(
		(input.attempts ?? []).map((item) => [item.runId, item]),
	),
	completed: input.completed ?? [],
	scheduledWakes: input.scheduledWakes ?? [],
});

describe("deriveBrief", () => {
	test("filters handled and failed counts after the anchor", () => {
		const model = deriveBrief(
			projection({
				completed: [
					completed("old", "done", 1000),
					completed("new", "done", 3000),
					completed("bad", "failed", 4000),
				],
			}),
			2000,
			5000,
		);

		expect(model.counts.handled).toBe(1);
		expect(model.counts.failed).toBe(1);
		expect(model.totals).toEqual({ handled: 2, failed: 1 });
		expect(model.outcomes.map((entry) => entry.completed.workKey)).toEqual([
			"bad",
			"new",
			"old",
		]);
		expect(model.outcomes.map((entry) => entry.isNew)).toEqual([
			true,
			true,
			false,
		]);
	});

	test("first visit counts all completed but marks nothing new", () => {
		const model = deriveBrief(
			projection({
				completed: [
					completed("a", "done", 1000),
					completed("b", "failed", 2000),
				],
			}),
			undefined,
			5000,
		);

		expect(model.counts.handled).toBe(1);
		expect(model.counts.failed).toBe(1);
		expect(model.outcomes.map((entry) => entry.isNew)).toEqual([false, false]);
	});

	test("empty projection returns empty report buckets", () => {
		const model = deriveBrief(projection({}), 1000, 5000);

		expect(model.counts).toEqual({
			handled: 0,
			failed: 0,
			needsYou: 0,
			acting: 0,
			incoming: 0,
		});
		expect(model.needsYou).toEqual([]);
		expect(model.acting).toEqual([]);
		expect(model.totals).toEqual({ handled: 0, failed: 0 });
		expect(model.comingUp).toEqual([]);
		expect(model.outcomes).toEqual([]);
	});

	test("coming up lists wakes by due time then waiting work by title", () => {
		const model = deriveBrief(
			projection({
				work: [
					work("z", "waiting", { title: "Zebra" }),
					work("a", "waiting", { title: "Alpha" }),
					work("linked", "pending", { title: "Linked work" }),
				],
				scheduledWakes: [
					{ dueAtMs: 3000, delayMs: 1000, reason: "later" },
					{ dueAtMs: 2000, delayMs: 1000, workKey: "linked" },
				],
			}),
			1000,
			1500,
		);

		expect(
			model.comingUp.map((entry) =>
				entry.kind === "wake"
					? `wake:${entry.wake.dueAtMs}:${entry.workTitle ?? ""}`
					: `waiting:${entry.work.title}`,
			),
		).toEqual([
			"wake:2000:Linked work",
			"wake:3000:",
			"waiting:Alpha",
			"waiting:Zebra",
		]);
	});

	test("counts done versus failed and reuses lane membership", () => {
		const model = deriveBrief(
			projection({
				work: [
					work("pending", "pending"),
					work("waiting", "waiting"),
					work("running", "running", { currentRunId: "run-1" }),
					work("blocked-b", "blocked"),
					work("blocked-a", "blocked"),
				],
				attempts: [attempt("run-1", "running", 3000)],
				completed: [
					completed("done", "done", 4000),
					completed("bad", "error", 5000),
				],
			}),
			1000,
			6000,
		);

		expect(model.counts.handled).toBe(1);
		expect(model.counts.failed).toBe(1);
		expect(model.counts.incoming).toBe(2);
		expect(model.counts.acting).toBe(1);
		expect(model.counts.needsYou).toBe(2);
		expect(model.needsYou.map((item) => item.workKey)).toEqual([
			"blocked-a",
			"blocked-b",
		]);
		expect(model.acting[0]?.attempt?.runId).toBe("run-1");
	});
});
