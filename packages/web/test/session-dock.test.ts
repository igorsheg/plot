import { expect, test } from "bun:test";
import type { RunRecord } from "@plot/registry/record";
import {
	AVATAR_COLORS,
	buildLiveTiles,
	buildPastTiles,
	DISTANCE,
	dockOrder,
	dockShortcutId,
	GHOST_TILE_KEY,
	magnify,
	nextDockKey,
	SCALE,
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

test("avatar palette is the approved five-color marble preset", () => {
	expect(AVATAR_COLORS).toHaveLength(5);
	expect(AVATAR_COLORS[0]).toBe("#00686c");
});

test("buildLiveTiles keeps non-stopped runs in createdAt order", () => {
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
	const tiles = buildLiveTiles(runs, "a");
	expect(tiles.map((tile) => tile.id)).toEqual(["a", "b"]);
	expect(tiles[0]?.name).toBe("alpha");
	expect(tiles[0]?.selected).toBe(true);
	expect(tiles[1]?.selected).toBe(false);
});

test("buildLiveTiles keeps an errored run live and flags it", () => {
	const runs = [run("boom", "error", { workflowName: "boom" })];
	const tiles = buildLiveTiles(runs, undefined);
	expect(tiles).toHaveLength(1);
	expect(tiles[0]?.errored).toBe(true);
});

test("buildPastTiles keeps stopped runs by lastSeenAt desc with stoppedAtMs", () => {
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
	const tiles = buildPastTiles(runs, "recent");
	expect(tiles.map((tile) => tile.id)).toEqual(["recent", "old"]);
	expect(tiles[0]?.stoppedAtMs).toBe(Date.parse("2026-01-02T00:00:00.000Z"));
	expect(tiles[0]?.selected).toBe(true);
});

test("dockOrder exposes live, expanded past, and ghost keys", () => {
	const live = [
		{ id: "one", name: "one", place: "repo", selected: false, errored: false },
	];
	const past = [
		{ id: "old", name: "old", place: "repo", selected: false, errored: false },
	];
	expect(dockOrder(live, past, false)).toEqual(["one", GHOST_TILE_KEY]);
	expect(dockOrder(live, past, true)).toEqual(["one", "old", GHOST_TILE_KEY]);
});

test("dock keyboard policy clamps movement and shortcuts to live tiles", () => {
	const order = ["one", "two", GHOST_TILE_KEY];
	expect(nextDockKey(order, "one", 1)).toBe("two");
	expect(nextDockKey(order, "one", -1)).toBe("one");
	expect(nextDockKey(order, GHOST_TILE_KEY, 1)).toBe(GHOST_TILE_KEY);
	expect(
		dockShortcutId(
			[
				{
					id: "one",
					name: "one",
					place: "repo",
					selected: false,
					errored: false,
				},
			],
			1,
		),
	).toBe("one");
	expect(dockShortcutId([], 1)).toBeUndefined();
});

test("magnify peaks at the tile center and flattens beyond DISTANCE", () => {
	expect(magnify(0).scale).toBeCloseTo(SCALE, 5);
	expect(magnify(0).nudge).toBeCloseTo(0, 5);
	expect(magnify(DISTANCE).scale).toBeCloseTo(1, 5);
	expect(magnify(-DISTANCE).scale).toBeCloseTo(1, 5);
	expect(magnify(DISTANCE + 500).scale).toBeCloseTo(1, 5);
});

test("magnify nudges tiles away from the cursor", () => {
	expect(magnify(-50).nudge).toBeGreaterThan(0);
	expect(magnify(50).nudge).toBeLessThan(0);
});

test("magnify is the identity transform when the cursor is absent", () => {
	expect(magnify(-Infinity)).toEqual({ scale: 1, nudge: 0 });
});
