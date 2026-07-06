/**
 * Pure view-model for the session-dock — no React, no motion. Turns the app's
 * runs into two ordered tile lists (live + past) and holds the macOS-dock
 * magnification math as a single pure function. The store adapter and the /lab
 * fixtures both feed the same `DockTile` shape, and every builder here is
 * unit-tested in isolation.
 */

import type { RunRecord } from "@plot/registry/record";
import { displayName } from "../../app/store.js";

export interface DockTile {
	readonly id: string;
	readonly name: string;
	readonly place: string;
	readonly selected: boolean;
	readonly errored: boolean;
	readonly stoppedAtMs?: number | undefined;
}

/**
 * Marble avatar palette — the one deliberate splash of color in the app.
 * Identity art is keyed on the session name, so the same workflow keeps its
 * marble across run restarts.
 */
export const AVATAR_COLORS = [
	"#00686c",
	"#32c2b9",
	"#edecb3",
	"#fad928",
	"#ff9915",
] as const;

const timeMs = (value: string | undefined): number | undefined => {
	if (value === undefined) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
};

const place = (run: RunRecord): string => run.cwdName ?? "session";

/**
 * The dock's live group is every run that has not been stopped — errored runs
 * stay live until stopped (binding UX), so this deliberately does not reuse the
 * store's `isRunLive` (which treats `error` as non-live).
 */
export const buildLiveTiles = (
	runs: readonly RunRecord[],
	selectedId: string | undefined,
): readonly DockTile[] =>
	runs
		.filter((run) => run.status !== "stopped")
		.toSorted((a, b) => (timeMs(a.createdAt) ?? 0) - (timeMs(b.createdAt) ?? 0))
		.map((run) => ({
			id: run.id,
			name: displayName(run),
			place: place(run),
			selected: run.id === selectedId,
			errored: run.status === "error",
		}));

/** Past group: stopped runs only, most-recently-seen first. */
export const buildPastTiles = (
	runs: readonly RunRecord[],
	selectedId: string | undefined,
): readonly DockTile[] =>
	runs
		.filter((run) => run.status === "stopped")
		.toSorted(
			(a, b) =>
				(timeMs(b.lastSeenAt ?? b.createdAt) ?? 0) -
				(timeMs(a.lastSeenAt ?? a.createdAt) ?? 0),
		)
		.map((run) => ({
			id: run.id,
			name: displayName(run),
			place: place(run),
			selected: run.id === selectedId,
			errored: false,
			stoppedAtMs: timeMs(run.lastSeenAt ?? run.createdAt),
		}));

/** Subtle — "enough to bring life and physics to it". */
export const SCALE = 1.22;
/** px before the cursor affects a tile. */
export const DISTANCE = 100;
/** px tiles are pushed away from the cursor. */
export const NUDGE = 10;
export const SPRING = { mass: 0.1, stiffness: 170, damping: 12 } as const;

export interface Magnification {
	readonly scale: number;
	readonly nudge: number;
}

/**
 * Pure magnification core (rotated 90° from the macOS reference): signed
 * `distance` from a tile's center to the cursor maps to a scale and a nudge.
 * `-Infinity` (cursor absent) is the identity transform.
 */
export const magnify = (distance: number): Magnification => {
	if (!Number.isFinite(distance)) return { scale: 1, nudge: 0 };
	const clamped = Math.max(-DISTANCE, Math.min(DISTANCE, distance));
	const scale = 1 + (SCALE - 1) * (1 - Math.abs(clamped) / DISTANCE);
	const nudge =
		distance < -DISTANCE || distance > DISTANCE
			? Math.sign(distance) * -1 * NUDGE
			: (-distance / DISTANCE) * NUDGE * scale;
	return { scale, nudge };
};
