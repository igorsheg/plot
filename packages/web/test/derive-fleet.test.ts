import { describe, expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import type { WorkItemProjection, WorkStatus } from "@plot/session/projection";
import type { WebDashboardProjection } from "../src/api.js";
import { deriveFleet, fleetStreamKey } from "../src/derive-fleet.js";
import type { PlotRun } from "../src/run.js";

const run = (input: Partial<PlotRun> & Pick<PlotRun, "id">): PlotRun => ({
	status: "running",
	cwd: "/repo",
	createdAt: "2026-01-01T00:00:00.000Z",
	workflowName: "Workflow",
	...input,
});

const work = (workKey: string, status: WorkStatus): WorkItemProjection => ({
	workKey,
	sourceId: "source-1",
	title: workKey,
	labels: [],
	status,
});

const projection = (
	runId: string,
	items: readonly WorkItemProjection[],
): readonly [string, WebDashboardProjection] => [
	runId,
	{
		...serializeDashboardProjection(emptyProjection("session-1", "workflow")),
		work: Object.fromEntries(items.map((item) => [item.workKey, item])),
	},
];

describe("deriveFleet", () => {
	test("groups runs by workflow and cwd", () => {
		const older = run({ id: "old", lastSeenAt: "2026-01-01T00:00:01.000Z" });
		const newer = run({ id: "new", lastSeenAt: "2026-01-01T00:00:02.000Z" });
		const streams = deriveFleet([older, newer], new Map(), 3_000);

		expect(streams).toHaveLength(1);
		expect(streams[0]?.currentRun.id).toBe("new");
		expect(streams[0]?.runs.map((entry) => entry.id)).toEqual(["new", "old"]);
	});

	test("derives needs-you, acting, and verbs from live projections", () => {
		const first = run({ id: "first", workflowName: "A" });
		const second = run({ id: "second", workflowName: "B" });
		const streams = deriveFleet(
			[first, second],
			new Map([
				projection("first", [work("blocked", "blocked")]),
				projection("second", [work("run", "running")]),
			]),
			3_000,
		);

		expect(streams.map((stream) => stream.name)).toEqual(["A", "B"]);
		expect(streams[0]?.needsYou).toBe(1);
		expect(streams[1]?.verb).toBe("acting on 1");
	});

	test("orders needs-you, crashed, acting, watching, paused, then ended", () => {
		const needsOld = run({
			id: "needs-old",
			workflowName: "Needs old",
			lastSeenAt: "2026-01-01T00:00:01.000Z",
		});
		const needsNew = run({
			id: "needs-new",
			workflowName: "Needs new",
			lastSeenAt: "2026-01-01T00:00:02.000Z",
		});
		const crashed = run({
			id: "crashed",
			workflowName: "Crashed",
			status: "failed",
			lastSeenAt: "2026-01-01T00:00:06.000Z",
		});
		const acting = run({
			id: "acting",
			workflowName: "Acting",
			lastSeenAt: "2026-01-01T00:00:05.000Z",
		});
		const watching = run({
			id: "watching",
			workflowName: "Watching",
			lastSeenAt: "2026-01-01T00:00:04.000Z",
		});
		const paused = run({
			id: "paused",
			workflowName: "Paused",
			status: "paused",
			lastSeenAt: "2026-01-01T00:00:03.000Z",
		});
		const ended = run({
			id: "ended",
			workflowName: "Ended",
			status: "stopped",
			lastSeenAt: "2026-01-01T00:00:07.000Z",
		});
		const streams = deriveFleet(
			[ended, paused, watching, acting, crashed, needsNew, needsOld],
			new Map([
				projection("needs-old", [work("blocked-old", "blocked")]),
				projection("needs-new", [work("blocked-new", "blocked")]),
				projection("acting", [work("run", "running")]),
			]),
			Date.parse("2026-01-01T00:00:08.000Z"),
		);

		expect(streams.map((stream) => stream.name)).toEqual([
			"Needs new",
			"Needs old",
			"Crashed",
			"Acting",
			"Watching",
			"Paused",
			"Ended",
		]);
		expect(streams[6]?.verb).toBe("ended 1s ago");
	});

	test("uses a stable stream key", () => {
		expect(fleetStreamKey(run({ id: "one" }))).toBe("Workflow\u0000/repo");
	});
});
