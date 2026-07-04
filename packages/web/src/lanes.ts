import type {
	CompletedWorkProjection,
	SerializedAgentAttemptProjection,
	WorkItemProjection,
	WorkStatus,
} from "@plot/session/projection";
import type { WebDashboardProjection } from "./api.js";

export type LaneId = "incoming" | "acting" | "needs-you" | "done";

export interface WorkLaneItem {
	readonly kind: "work";
	readonly work: WorkItemProjection;
	readonly attempt?: SerializedAgentAttemptProjection | undefined;
}

export interface CompletedLaneItem {
	readonly kind: "completed";
	readonly completed: CompletedWorkProjection;
}

export type LaneItem = WorkLaneItem | CompletedLaneItem;

export interface Lanes {
	readonly incoming: readonly WorkLaneItem[];
	readonly acting: readonly WorkLaneItem[];
	readonly needsYou: readonly WorkLaneItem[];
	readonly done: readonly LaneItem[];
}

export const laneOf = (status: WorkStatus): LaneId => {
	switch (status) {
		case "pending":
		case "waiting":
			return "incoming";
		case "running":
		case "draining":
			return "acting";
		case "blocked":
			return "needs-you";
		case "done":
		case "failed":
			return "done";
	}
};

const attemptFor = (
	projection: WebDashboardProjection,
	work: WorkItemProjection,
): SerializedAgentAttemptProjection | undefined => {
	if (work.currentRunId !== undefined) {
		const current = projection.attempts[work.currentRunId];
		if (current !== undefined) return current;
	}
	let latest: SerializedAgentAttemptProjection | undefined;
	for (const attempt of Object.values(projection.attempts)) {
		if (attempt.workKey !== work.workKey) continue;
		if (latest === undefined || attempt.lastEventSeq > latest.lastEventSeq)
			latest = attempt;
	}
	return latest;
};

export const deriveLanes = (projection: WebDashboardProjection): Lanes => {
	const incoming: WorkLaneItem[] = [];
	const acting: WorkLaneItem[] = [];
	const needsYou: WorkLaneItem[] = [];
	const doneWork: WorkLaneItem[] = [];
	const completedKeys = new Set(
		projection.completed.map((entry) => entry.workKey),
	);

	for (const work of Object.values(projection.work)) {
		const item: WorkLaneItem = {
			kind: "work",
			work,
			attempt: attemptFor(projection, work),
		};
		switch (laneOf(work.status)) {
			case "incoming":
				incoming.push(item);
				break;
			case "acting":
				acting.push(item);
				break;
			case "needs-you":
				needsYou.push(item);
				break;
			case "done":
				if (!completedKeys.has(work.workKey)) doneWork.push(item);
				break;
		}
	}

	acting.sort(
		(left, right) =>
			(right.attempt?.lastEventAtMs ?? 0) - (left.attempt?.lastEventAtMs ?? 0),
	);
	const completed = projection.completed
		.map(
			(entry): CompletedLaneItem => ({ kind: "completed", completed: entry }),
		)
		.toSorted((left, right) => right.completed.atMs - left.completed.atMs);

	return { incoming, acting, needsYou, done: [...completed, ...doneWork] };
};

/** Changes exactly when some work item moves between lanes (drives view transitions). */
export const laneSignature = (projection: WebDashboardProjection): string =>
	Object.values(projection.work)
		.map((work) => `${work.workKey}:${laneOf(work.status)}`)
		.toSorted()
		.join("|");
