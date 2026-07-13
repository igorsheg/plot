/** Pure view-model for the Session dock. */

import type { SessionSummary } from "@plot/session-manager/session";
import { displayName } from "../../app/sessions-store.js";

export interface DockLineItem {
	readonly id: string;
	readonly title: string;
	readonly place: string;
	readonly selected: boolean;
	readonly attention: boolean;
	readonly stoppedAtMs?: number;
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

const timeMs = (value: string): number | undefined => {
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
};

const place = (session: SessionSummary): string =>
	session.projectPath.split("/").at(-1) ?? "session";

export const buildLiveLines = (
	sessions: readonly SessionSummary[],
	selectedId: string | undefined,
): readonly DockLineItem[] =>
	sessions
		.filter(
			(session) => session.state !== "stopped" && session.state !== "error",
		)
		.toSorted((a, b) => timeMs(a.createdAt)! - timeMs(b.createdAt)!)
		.map((session) => ({
			id: session.id,
			title: displayName(session),
			place: place(session),
			selected: session.id === selectedId,
			attention: false,
		}));

export const buildPastLines = (
	sessions: readonly SessionSummary[],
	selectedId: string | undefined,
): readonly DockLineItem[] =>
	sessions
		.filter(
			(session) => session.state === "stopped" || session.state === "error",
		)
		.toSorted((a, b) => timeMs(b.updatedAt)! - timeMs(a.updatedAt)!)
		.map((session) => {
			const item: DockLineItem = {
				id: session.id,
				title: displayName(session),
				place: place(session),
				selected: session.id === selectedId,
				attention: session.state === "error",
			};
			const stoppedAtMs = timeMs(session.updatedAt);
			if (stoppedAtMs !== undefined) return { ...item, stoppedAtMs };
			return item;
		});
