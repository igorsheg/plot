import type { WebDashboardProjection } from "./api.js";
import { laneOf } from "./lanes.js";
import type { PlotRun } from "./run.js";

export type FleetStreamState =
	| "acting"
	| "crashed"
	| "ended"
	| "paused"
	| "watching";

export interface FleetStream {
	readonly key: string;
	readonly name: string;
	readonly cwd: string;
	readonly cwdName: string;
	readonly runs: readonly PlotRun[];
	readonly currentRun: PlotRun;
	readonly needsYou: number;
	readonly acting: number;
	readonly state: FleetStreamState;
	readonly verb: string;
	readonly lastSeenMs: number;
}

const isLive = (run: PlotRun): boolean =>
	run.status === "online" || run.status === "running";

const streamName = (run: PlotRun): string =>
	run.workflowName ?? run.label ?? run.id;

const cwdName = (run: PlotRun): string =>
	run.cwdName ?? run.cwd.split("/").findLast((part) => part !== "") ?? run.cwd;

export const fleetStreamKey = (run: PlotRun): string =>
	`${streamName(run)}\u0000${run.cwd}`;

const parseSeen = (run: PlotRun): number => {
	const ms = Date.parse(run.lastSeenAt ?? run.createdAt);
	return Number.isFinite(ms) ? ms : 0;
};

const formatAgoFrom = (atMs: number, nowMs: number): string => {
	const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${Math.round(seconds / 3600)}h`;
};

const currentRunFor = (runs: readonly PlotRun[]): PlotRun =>
	runs.toSorted((left, right) => {
		const live = Number(isLive(right)) - Number(isLive(left));
		if (live !== 0) return live;
		return parseSeen(right) - parseSeen(left);
	})[0]!;

const projectionNeedsYou = (projection: WebDashboardProjection): number =>
	Object.values(projection.work).filter(
		(work) => laneOf(work.status) === "needs-you",
	).length;

const projectionActing = (projection: WebDashboardProjection): number =>
	Object.values(projection.work).filter(
		(work) => laneOf(work.status) === "acting",
	).length;

const stateFor = (
	runs: readonly PlotRun[],
	projections: ReadonlyMap<string, WebDashboardProjection>,
	acting: number,
): FleetStreamState => {
	if (runs.some((run) => run.status === "error" || run.status === "failed"))
		return "crashed";
	if (acting > 0) return "acting";
	if (
		runs.some(
			(run) =>
				run.status === "paused" || projections.get(run.id)?.status === "paused",
		)
	)
		return "paused";
	if (runs.some(isLive)) return "watching";
	return "ended";
};

const verbFor = (
	state: FleetStreamState,
	acting: number,
	lastSeenMs: number,
	nowMs: number,
): string => {
	switch (state) {
		case "acting":
			return `acting on ${acting}`;
		case "watching":
			return "watching";
		case "paused":
			return "paused";
		case "crashed":
			return "crashed";
		case "ended":
			return `ended ${formatAgoFrom(lastSeenMs, nowMs)} ago`;
	}
};

const stateRank = (stream: FleetStream): number => {
	if (stream.needsYou > 0) return 0;
	switch (stream.state) {
		case "crashed":
			return 1;
		case "acting":
			return 2;
		case "watching":
			return 3;
		case "paused":
			return 4;
		case "ended":
			return 5;
	}
};

export const deriveFleet = (
	runs: readonly PlotRun[],
	projections: ReadonlyMap<string, WebDashboardProjection>,
	nowMs: number,
): readonly FleetStream[] => {
	const groups = new Map<string, PlotRun[]>();
	for (const run of runs) {
		const key = fleetStreamKey(run);
		groups.set(key, [...(groups.get(key) ?? []), run]);
	}
	return [...groups.entries()]
		.map(([key, streamRuns]) => {
			const currentRun = currentRunFor(streamRuns);
			const streamProjections = streamRuns.flatMap((run) => {
				const projection = projections.get(run.id);
				return projection === undefined ? [] : [projection];
			});
			const needsYou = streamProjections.reduce(
				(sum, projection) => sum + projectionNeedsYou(projection),
				0,
			);
			const acting = streamProjections.reduce(
				(sum, projection) => sum + projectionActing(projection),
				0,
			);
			const lastSeenMs = Math.max(...streamRuns.map(parseSeen));
			const state = stateFor(streamRuns, projections, acting);
			return {
				key,
				name: streamName(currentRun),
				cwd: currentRun.cwd,
				cwdName: cwdName(currentRun),
				runs: streamRuns.toSorted(
					(left, right) => parseSeen(right) - parseSeen(left),
				),
				currentRun,
				needsYou,
				acting,
				state,
				verb: verbFor(state, acting, lastSeenMs, nowMs),
				lastSeenMs,
			};
		})
		.toSorted((left, right) => {
			const rank = stateRank(left) - stateRank(right);
			if (rank !== 0) return rank;
			return right.lastSeenMs - left.lastSeenMs;
		});
};
