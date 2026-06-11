import type {
	DashboardProjection,
	RunningWorkProjection,
	WorkStage,
} from "./projection.js";

export interface FleetRowModel {
	readonly work: RunningWorkProjection;
	readonly label: string;
	readonly stage: WorkStage;
	readonly ageTurn: string;
	readonly tokens: string;
	readonly check: RunningWorkProjection["check"];
	readonly activity: string;
	readonly last: string;
	readonly stale: boolean;
}

export interface DashboardModel {
	readonly running: readonly FleetRowModel[];
	readonly totalTokens: string;
}

const formatter = new Intl.NumberFormat("en-US");
export const formatCount = (value: number) => formatter.format(value);

export const formatDuration = (ms: number) => {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
};

const rankStage = (stage: WorkStage) =>
	stage === "failed" || stage === "blocked" ? 0 : 1;

const tokenTotal = (work: RunningWorkProjection) => work.tokens?.total ?? 0;

const workLabel = (work: RunningWorkProjection) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;

const staleThresholdMs = 2 * 60 * 1000;

const ageAndTurns = (work: RunningWorkProjection, nowMs: number) => {
	const age =
		work.startedAtMs === undefined
			? "n/a"
			: formatDuration(nowMs - work.startedAtMs);
	return `${age} / t${work.turnCount}`;
};

const isStale = (work: RunningWorkProjection, nowMs: number) =>
	work.lastEventAtMs !== undefined &&
	nowMs - work.lastEventAtMs > staleThresholdMs;

export const dashboardModelFrom = (
	projection: DashboardProjection,
	nowMs = Date.now(),
): DashboardModel => {
	const running = [...projection.running.values()]
		.sort(
			(a, b) =>
				rankStage(a.stage) - rankStage(b.stage) ||
				a.startedAtSeq - b.startedAtSeq,
		)
		.map((work) => ({
			work,
			label: workLabel(work),
			stage: work.stage,
			ageTurn: ageAndTurns(work, nowMs),
			tokens: formatCount(tokenTotal(work)),
			check: work.check,
			activity: work.activity,
			last: work.lastMeaningful,
			stale: isStale(work, nowMs),
		}));
	const totalTokens = formatCount(
		[...projection.running.values()].reduce(
			(total, work) => total + tokenTotal(work),
			0,
		),
	);
	return { running, totalTokens };
};
