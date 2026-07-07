/**
 * Pure view-model for the session dock. The dock is a line-nav control: live
 * sessions first, optionally revealed past sessions, then a ghost line that
 * toggles the past group. No React and no animation primitives live here.
 */

import type { RunRecord } from "@plot/registry/record";
import { displayName } from "../../app/runs-store.js";

export interface DockLineItem {
	readonly id: string;
	readonly title: string;
	readonly place: string;
	readonly selected: boolean;
	readonly attention: boolean;
	readonly stoppedAtMs?: number | undefined;
}

export const GHOST_LINE_KEY = "__dock_ghost__";

export const LINE_WIDTH = {
	normal: 24,
	attention: 32,
	active: 40,
	hover: 40,
} as const;

export const dockLineOrder = (
	live: readonly DockLineItem[],
	past: readonly DockLineItem[],
	expanded: boolean,
): readonly string[] => {
	const keys = live.map((item) => item.id);
	if (expanded) for (const item of past) keys.push(item.id);
	if (past.length > 0) keys.push(GHOST_LINE_KEY);
	return keys;
};

export const nextDockKey = (
	order: readonly string[],
	current: string | null,
	direction: 1 | -1,
): string | undefined => {
	if (order.length === 0) return undefined;
	const index = current === null ? -1 : order.indexOf(current);
	const start = index === -1 ? 0 : index;
	const next = Math.min(order.length - 1, Math.max(0, start + direction));
	return order[next];
};

export const dockShortcutId = (
	live: readonly DockLineItem[],
	digit: number,
): string | undefined => live[digit - 1]?.id;

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
export const buildLiveLines = (
	runs: readonly RunRecord[],
	selectedId: string | undefined,
): readonly DockLineItem[] =>
	runs
		.filter((run) => run.status !== "stopped")
		.toSorted((a, b) => (timeMs(a.createdAt) ?? 0) - (timeMs(b.createdAt) ?? 0))
		.map((run) => ({
			id: run.id,
			title: displayName(run),
			place: place(run),
			selected: run.id === selectedId,
			attention: run.status === "error",
		}));

/** Past group: stopped runs only, most-recently-seen first. */
export const buildPastLines = (
	runs: readonly RunRecord[],
	selectedId: string | undefined,
): readonly DockLineItem[] =>
	runs
		.filter((run) => run.status === "stopped")
		.toSorted(
			(a, b) =>
				(timeMs(b.lastSeenAt ?? b.createdAt) ?? 0) -
				(timeMs(a.lastSeenAt ?? a.createdAt) ?? 0),
		)
		.map((run) => ({
			id: run.id,
			title: displayName(run),
			place: place(run),
			selected: run.id === selectedId,
			attention: false,
			stoppedAtMs: timeMs(run.lastSeenAt ?? run.createdAt),
		}));
