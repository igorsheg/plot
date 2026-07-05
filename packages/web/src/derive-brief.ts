import type {
	CompletedWorkProjection,
	ScheduledWakeProjection,
	WorkItemProjection,
} from "@plot/session/projection";
import type { WebDashboardProjection } from "./api.js";
import { deriveLanes, laneOf, type WorkLaneItem } from "./lanes.js";

export interface BriefModel {
	readonly counts: {
		readonly handled: number;
		readonly failed: number;
		readonly needsYou: number;
		readonly acting: number;
		readonly incoming: number;
	};
	readonly totals: {
		readonly handled: number;
		readonly failed: number;
	};
	readonly needsYou: readonly WorkItemProjection[];
	readonly acting: readonly WorkLaneItem[];
	readonly comingUp: readonly ComingUpEntry[];
	readonly outcomes: readonly OutcomeEntry[];
}

export type ComingUpEntry =
	| {
			readonly kind: "wake";
			readonly wake: ScheduledWakeProjection;
			readonly workTitle?: string | undefined;
	  }
	| { readonly kind: "waiting"; readonly work: WorkItemProjection };

export interface OutcomeEntry {
	readonly completed: CompletedWorkProjection;
	readonly isNew: boolean;
}

const afterAnchor = (atMs: number, anchorMs: number | undefined): boolean =>
	anchorMs === undefined || atMs > anchorMs;

export const deriveBrief = (
	projection: WebDashboardProjection,
	anchorMs: number | undefined,
	_nowMs: number,
): BriefModel => {
	const lanes = deriveLanes(projection);
	const completedSince = projection.completed.filter((entry) =>
		afterAnchor(entry.atMs, anchorMs),
	);
	const totals = {
		handled: projection.completed.filter((entry) => entry.status === "done")
			.length,
		failed: projection.completed.filter((entry) => entry.status !== "done")
			.length,
	};
	const needsYou = Object.values(projection.work)
		.filter((work) => laneOf(work.status) === "needs-you")
		.toSorted((left, right) => left.workKey.localeCompare(right.workKey));
	const waiting = Object.values(projection.work)
		.filter((work) => work.status === "waiting")
		.toSorted((left, right) => left.title.localeCompare(right.title));
	const wakes = projection.scheduledWakes
		.toSorted((left, right) => left.dueAtMs - right.dueAtMs)
		.map(
			(wake): ComingUpEntry => ({
				kind: "wake",
				wake,
				...(wake.workKey === undefined ||
				projection.work[wake.workKey]?.title === undefined
					? {}
					: { workTitle: projection.work[wake.workKey]?.title }),
			}),
		);
	return {
		counts: {
			handled: completedSince.filter((entry) => entry.status === "done").length,
			failed: completedSince.filter((entry) => entry.status !== "done").length,
			needsYou: needsYou.length,
			acting: lanes.acting.length,
			incoming: lanes.incoming.length,
		},
		totals,
		needsYou,
		acting: lanes.acting,
		comingUp: [
			...wakes,
			...waiting.map((work): ComingUpEntry => ({ kind: "waiting", work })),
		],
		outcomes: projection.completed
			.toSorted((left, right) => right.atMs - left.atMs)
			.map((completed) => ({
				completed,
				isNew: anchorMs === undefined ? false : completed.atMs > anchorMs,
			})),
	};
};
