import { expect, test } from "bun:test";
import type { SessionSummary } from "@plot/session-manager/session";
import {
	buildLiveLines,
	buildPastLines,
	dockLineOrder,
	dockShortcutId,
	GHOST_LINE_KEY,
	LINE_WIDTH,
	nextDockKey,
} from "../src/components/session-dock/view-model.js";

const session = (
	id: string,
	state: SessionSummary["state"],
	extra: Partial<SessionSummary> = {},
): SessionSummary => ({
	id,
	workflowKey: `/tmp/${id}/WORKFLOW.md`,
	workflowName: id,
	workflowPath: `/tmp/${id}/WORKFLOW.md`,
	workflowAliases: [`/tmp/${id}/WORKFLOW.md`],
	projectPath: `/tmp/${id}`,
	state,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: `/tmp/${id}/.plot/sessions/${id}.jsonl`,
	lastSequence: 0,
	...extra,
});

test("line width tokens encode idle, attention, active, and hover states", () => {
	expect(LINE_WIDTH.normal).toBe(24);
	expect(LINE_WIDTH.attention).toBeGreaterThan(LINE_WIDTH.normal);
	expect(LINE_WIDTH.active).toBe(LINE_WIDTH.hover);
});

test("buildLiveLines keeps non-stopped runs in createdAt order", () => {
	const runs = [
		session("b", "online", {
			createdAt: "2026-01-02T00:00:00.000Z",
			workflowName: "beta",
		}),
		session("a", "online", {
			createdAt: "2026-01-01T00:00:00.000Z",
			workflowName: "alpha",
		}),
		session("gone", "stopped"),
	];
	const lines = buildLiveLines(runs, "a");
	expect(lines.map((line) => line.id)).toEqual(["a", "b"]);
	expect(lines[0]?.title).toBe("alpha");
	expect(lines[0]?.selected).toBe(true);
	expect(lines[1]?.selected).toBe(false);
});

test("buildPastLines keeps errored Sessions and marks them for attention", () => {
	const sessions = [session("boom", "error", { workflowName: "boom" })];
	const lines = buildPastLines(sessions, undefined);
	expect(lines).toHaveLength(1);
	expect(lines[0]?.attention).toBe(true);
});

test("buildPastLines keeps stopped runs by updatedAt desc with stoppedAtMs", () => {
	const runs = [
		session("live", "online"),
		session("old", "stopped", {
			updatedAt: "2026-01-01T00:00:00.000Z",
			workflowName: "old",
		}),
		session("recent", "stopped", {
			updatedAt: "2026-01-02T00:00:00.000Z",
			workflowName: "recent",
		}),
		session("errored", "error", {
			updatedAt: "2026-01-03T00:00:00.000Z",
		}),
	];
	const lines = buildPastLines(runs, "recent");
	expect(lines.map((line) => line.id)).toEqual(["errored", "recent", "old"]);
	expect(lines[0]?.stoppedAtMs).toBe(Date.parse("2026-01-03T00:00:00.000Z"));
	expect(lines[1]?.selected).toBe(true);
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
