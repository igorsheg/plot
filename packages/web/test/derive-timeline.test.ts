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
import { deriveTimeline } from "../src/derive-timeline.js";

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
	input: Partial<CompletedWorkProjection> = {},
): CompletedWorkProjection => ({
	workKey,
	label: workKey,
	status: "succeeded",
	message: "settled",
	atMs: 1000,
	...input,
});

const attempt = (
	runId: string,
	workKey: string,
	input: Partial<SerializedAgentAttemptProjection> = {},
): SerializedAgentAttemptProjection => ({
	runId,
	workKey,
	sourceId: "source-1",
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: 2,
	lastEventAtMs: 1000,
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
	...input,
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

describe("deriveTimeline", () => {
	test("turns completed entries into scaled spans", () => {
		const model = deriveTimeline(
			projection({
				work: [work("done", "done", { title: "Done work" })],
				completed: [
					completed("done", {
						atMs: 100_000,
						durationMs: 20_000,
						tokens: { total: 1_800_000 },
					}),
				],
			}),
			120_000,
			true,
		);

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.title).toBe("Done work");
		expect(model.rows[0]?.spans).toEqual([
			{
				startMs: 80_000,
				endMs: 100_000,
				tone: "success",
				label: "done · 20s · 1.8M tok",
			},
		]);
	});

	test("running spans reach now", () => {
		const model = deriveTimeline(
			projection({
				work: [work("running", "running", { currentRunId: "run-1" })],
				attempts: [
					attempt("run-1", "running", {
						startedAtMs: 90_000,
						lastEventAtMs: 95_000,
						turnCount: 3,
					}),
				],
			}),
			100_000,
			true,
		);

		expect(model.rows[0]?.running).toBe(true);
		expect(model.rows[0]?.spans[0]).toEqual({
			startMs: 90_000,
			endMs: 100_000,
			tone: "running",
			label: "running · 3 turns",
		});
	});

	test("attaches work wakes and leaves session wakes separate", () => {
		const model = deriveTimeline(
			projection({
				work: [work("known", "pending", { title: "Known work" })],
				scheduledWakes: [
					{
						dueAtMs: 130_000,
						delayMs: 1_000,
						workKey: "known",
						reason: "check",
					},
					{ dueAtMs: 140_000, delayMs: 1_000, workKey: "missing", attempt: 2 },
					{ dueAtMs: 150_000, delayMs: 1_000, reason: "scan" },
				],
			}),
			120_000,
			true,
		);

		expect(model.rows).toHaveLength(1);
		expect(model.rows[0]?.workKey).toBe("known");
		expect(model.rows[0]?.marks).toEqual([
			{ atMs: 130_000, kind: "wake", label: "check" },
		]);
		expect(model.sessionMarks).toEqual([
			{ atMs: 140_000, kind: "retry", label: "retry #2 — tick" },
			{ atMs: 150_000, kind: "wake", label: "scan" },
		]);
	});

	test("clamps the domain at twenty four hours and clips spans", () => {
		const nowMs = 100 * 60 * 60 * 1000;
		const hourMs = 60 * 60 * 1000;
		const model = deriveTimeline(
			projection({
				completed: [
					completed("kept", {
						atMs: nowMs - 23 * hourMs,
						durationMs: 2 * hourMs,
					}),
					completed("dropped", {
						atMs: nowMs - 25 * hourMs,
						durationMs: hourMs,
					}),
				],
			}),
			nowMs,
			true,
		);

		expect(model.domainStartMs).toBe(nowMs - 24 * hourMs);
		expect(model.rows.map((row) => row.workKey)).toEqual(["kept"]);
		expect(model.rows[0]?.spans[0]?.startMs).toBe(model.domainStartMs);
		expect(model.rows[0]?.spans[0]?.endMs).toBe(nowMs - 23 * hourMs);
	});

	test("ended domain hugs content", () => {
		const hourMs = 60 * 60 * 1000;
		const contentEndMs = 10 * hourMs;
		const latestContentMs = contentEndMs + 30 * 60 * 1000;
		const nowMs = 100 * hourMs;
		const model = deriveTimeline(
			projection({
				completed: [
					completed("done", {
						atMs: contentEndMs,
						durationMs: 20 * 60 * 1000,
					}),
				],
				scheduledWakes: [{ dueAtMs: latestContentMs, delayMs: 1_000 }],
			}),
			nowMs,
			false,
		);

		expect(model.domainStartMs).toBe(latestContentMs - hourMs);
		expect(model.domainEndMs).toBe(latestContentMs + hourMs * 0.03);
		expect(model.domainEndMs).toBeLessThan(nowMs);
		expect(model.rows).toHaveLength(1);
	});

	test("live domain reaches now", () => {
		const hourMs = 60 * 60 * 1000;
		const nowMs = 100 * hourMs;
		const model = deriveTimeline(
			projection({
				completed: [
					completed("done", {
						atMs: 10 * hourMs,
						durationMs: 20 * 60 * 1000,
					}),
				],
			}),
			nowMs,
			true,
		);

		expect(model.domainStartMs).toBe(nowMs - 24 * hourMs);
		expect(model.domainEndMs).toBeGreaterThan(nowMs);
	});

	test("orders running rows first, then last activity descending", () => {
		const model = deriveTimeline(
			projection({
				work: [work("run", "running")],
				attempts: [attempt("run-1", "run", { startedAtMs: 190_000 })],
				completed: [
					completed("new", { atMs: 180_000, durationMs: 1_000 }),
					completed("old", { atMs: 170_000, durationMs: 1_000 }),
				],
			}),
			200_000,
			true,
		);

		expect(model.rows.map((row) => row.workKey)).toEqual(["run", "new", "old"]);
	});

	test("uses a visible fallback span for missing durations", () => {
		const model = deriveTimeline(
			projection({
				completed: [completed("failed", { status: "failed", atMs: 100_000 })],
			}),
			120_000,
			true,
		);

		expect(model.rows[0]?.spans[0]).toEqual({
			startMs: 70_000,
			endMs: 100_000,
			tone: "failed",
			label: "failed · 30s",
		});
	});
});
