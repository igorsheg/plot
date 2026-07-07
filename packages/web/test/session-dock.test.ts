import { expect, test } from "bun:test";
import type { RunRecord } from "@plot/registry/record";
import {
	buildLiveLines,
	buildPastLines,
	dockLineOrder,
	dockShortcutId,
	GHOST_LINE_KEY,
	LINE_WIDTH,
	nextDockKey,
} from "../src/components/session-dock/view-model.js";

const run = (
	id: string,
	status: RunRecord["status"],
	extra: Partial<RunRecord> = {},
): RunRecord => ({
	id,
	status,
	cwd: `/tmp/${id}`,
	createdAt: "2026-01-01T00:00:00.000Z",
	...extra,
});

test("line width tokens encode idle, attention, active, and hover states", () => {
	expect(LINE_WIDTH.normal).toBe(24);
	expect(LINE_WIDTH.attention).toBeGreaterThan(LINE_WIDTH.normal);
	expect(LINE_WIDTH.active).toBe(LINE_WIDTH.hover);
});

test("buildLiveLines keeps non-stopped runs in createdAt order", () => {
	const runs = [
		run("b", "online", {
			createdAt: "2026-01-02T00:00:00.000Z",
			workflowName: "beta",
		}),
		run("a", "online", {
			createdAt: "2026-01-01T00:00:00.000Z",
			workflowName: "alpha",
		}),
		run("gone", "stopped"),
	];
	const lines = buildLiveLines(runs, "a");
	expect(lines.map((line) => line.id)).toEqual(["a", "b"]);
	expect(lines[0]?.title).toBe("alpha");
	expect(lines[0]?.selected).toBe(true);
	expect(lines[1]?.selected).toBe(false);
});

test("buildLiveLines keeps an errored run live and marks it for attention", () => {
	const runs = [run("boom", "error", { workflowName: "boom" })];
	const lines = buildLiveLines(runs, undefined);
	expect(lines).toHaveLength(1);
	expect(lines[0]?.attention).toBe(true);
});

test("buildPastLines keeps stopped runs by lastSeenAt desc with stoppedAtMs", () => {
	const runs = [
		run("live", "online"),
		run("old", "stopped", {
			lastSeenAt: "2026-01-01T00:00:00.000Z",
			workflowName: "old",
		}),
		run("recent", "stopped", {
			lastSeenAt: "2026-01-02T00:00:00.000Z",
			workflowName: "recent",
		}),
		run("errored", "error"),
	];
	const lines = buildPastLines(runs, "recent");
	expect(lines.map((line) => line.id)).toEqual(["recent", "old"]);
	expect(lines[0]?.stoppedAtMs).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
	expect(lines[0]?.selected).toBe(true);
});

test("dockLineOrder exposes live, expanded past, and ghost keys", () => {
	const live = [
		{
			id: "one",
			title: "one",
			place: "repo",
			selected: false,
			attention: false,
		},
	];
	const past = [
		{
			id: "old",
			title: "old",
			place: "repo",
			selected: false,
			attention: false,
		},
	];
	expect(dockLineOrder(live, past, false)).toEqual(["one", GHOST_LINE_KEY]);
	expect(dockLineOrder(live, past, true)).toEqual([
		"one",
		"old",
		GHOST_LINE_KEY,
	]);
});

test("dock keyboard policy clamps movement and shortcuts to live lines", () => {
	const order = ["one", "two", GHOST_LINE_KEY];
	expect(nextDockKey(order, "one", 1)).toBe("two");
	expect(nextDockKey(order, "one", -1)).toBe("one");
	expect(nextDockKey(order, GHOST_LINE_KEY, 1)).toBe(GHOST_LINE_KEY);
	expect(
		dockShortcutId(
			[
				{
					id: "one",
					title: "one",
					place: "repo",
					selected: false,
					attention: false,
				},
			],
			1,
		),
	).toBe("one");
	expect(dockShortcutId([], 1)).toBeUndefined();
});
