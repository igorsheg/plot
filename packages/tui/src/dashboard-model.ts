import {
	workLabel,
	type DashboardProjection,
	type ActivityTone,
	type RunningWorkProjection,
	type WorkStage,
} from "./projection.js";

export interface PulseModel {
	readonly tick?: {
		readonly id: number;
		readonly ago: string;
		readonly found: number;
		readonly started: number;
	};
	readonly nextWake?: {
		readonly inSeconds: number;
		readonly reason?: string;
	};
	readonly runningCount: number;
	readonly totalTokens: string;
}

export interface AttentionItemModel {
	readonly workKey?: string;
	readonly text: string;
}

export interface WorkRowModel {
	readonly work: RunningWorkProjection;
	readonly label: string;
	readonly stage: WorkStage;
	readonly age: string;
	readonly turns: string;
	readonly tokens: string;
	readonly activity: string;
	readonly lastEventAgo: string;
	readonly stale: boolean;
	readonly attention: boolean;
}

export interface ScheduledRowModel {
	readonly inSeconds: number;
	readonly reason?: string;
}

export interface ActivityRowModel {
	readonly ago: string;
	readonly tone: ActivityTone;
	readonly text: string;
}

export interface DashboardModel {
	readonly pulse: PulseModel;
	readonly attention: readonly AttentionItemModel[];
	readonly work: readonly WorkRowModel[];
	readonly scheduled: readonly ScheduledRowModel[];
	readonly activity: readonly ActivityRowModel[];
}

const countFormatter = new Intl.NumberFormat("en-US");
export const formatCount = (value: number) => countFormatter.format(value);

export const formatTokens = (value: number) => {
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
};

export const formatDuration = (ms: number) => {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h ${minutes % 60}m`;
	if (minutes > 0)
		return `${minutes}m ${(seconds % 60).toString().padStart(2, "0")}s`;
	return `${seconds}s`;
};

export const formatAgo = (ms: number) => `${formatDuration(ms)} ago`;

const staleThresholdMs = 2 * 60 * 1000;

const needsAttention = (stage: WorkStage) =>
	stage === "blocked" || stage === "failed";

const isStale = (work: RunningWorkProjection, nowMs: number) =>
	work.lastEventAtMs !== undefined &&
	nowMs - work.lastEventAtMs > staleThresholdMs;

const tokenTotal = (work: RunningWorkProjection) => work.tokens?.total ?? 0;

const workRow = (work: RunningWorkProjection, nowMs: number): WorkRowModel => ({
	work,
	label: workLabel(work),
	stage: work.stage,
	age:
		work.startedAtMs === undefined
			? "n/a"
			: formatDuration(nowMs - work.startedAtMs),
	turns: `t${work.turnCount}`,
	tokens: formatTokens(tokenTotal(work)),
	activity: work.activity,
	lastEventAgo:
		work.lastEventAtMs === undefined
			? ""
			: formatAgo(nowMs - work.lastEventAtMs),
	stale: isStale(work, nowMs),
	attention: needsAttention(work.stage),
});

const attentionFrom = (
	rows: readonly WorkRowModel[],
	diagnostics: readonly string[],
): readonly AttentionItemModel[] => [
	...rows
		.filter((row) => row.attention)
		.map((row) => ({
			workKey: row.work.workKey,
			text: `${row.label} ${row.stage} · ${row.work.lastMeaningful} · ${row.lastEventAgo}`,
		})),
	...rows
		.filter((row) => row.stale && !row.attention)
		.map((row) => ({
			workKey: row.work.workKey,
			text: `${row.label} stale · last event ${row.lastEventAgo}`,
		})),
	...diagnostics.map((diagnostic) => ({ text: diagnostic })),
];

export const dashboardModelFrom = (
	projection: DashboardProjection,
	nowMs = Date.now(),
): DashboardModel => {
	const rows = [...projection.running.values()]
		.map((work) => workRow(work, nowMs))
		.sort(
			(a, b) =>
				Number(b.attention) - Number(a.attention) ||
				a.work.startedAtSeq - b.work.startedAtSeq,
		);
	const totalTokens = formatTokens(
		[...projection.running.values()].reduce(
			(total, work) => total + tokenTotal(work),
			0,
		),
	);
	const nextWake = projection.scheduledWakes[0];
	return {
		pulse: {
			...(projection.pulse === undefined
				? {}
				: {
						tick: {
							id: projection.pulse.tickId,
							ago: formatAgo(nowMs - projection.pulse.atMs),
							found: projection.pulse.found,
							started: projection.pulse.started,
						},
					}),
			...(nextWake === undefined
				? {}
				: {
						nextWake: {
							inSeconds: Math.ceil(
								Math.max(0, nextWake.dueAtMs - nowMs) / 1000,
							),
							...(nextWake.reason === undefined
								? {}
								: { reason: nextWake.reason }),
						},
					}),
			runningCount: rows.length,
			totalTokens,
		},
		attention: attentionFrom(rows, projection.diagnostics),
		work: rows,
		scheduled: projection.scheduledWakes.slice(0, 5).map((wake) => ({
			inSeconds: Math.ceil(Math.max(0, wake.dueAtMs - nowMs) / 1000),
			...(wake.reason === undefined ? {} : { reason: wake.reason }),
		})),
		activity: projection.activity.slice(0, 20).map((entry) => ({
			ago: formatAgo(nowMs - entry.atMs),
			tone: entry.tone,
			text: entry.text,
		})),
	};
};
