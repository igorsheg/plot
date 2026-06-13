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
	readonly maxConcurrentRuns?: number;
	readonly totalTokens: string;
	readonly totalCost?: string;
	readonly throughput: string;
	readonly throughputGraph: string;
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
	readonly workKey?: string;
	readonly label?: string;
	readonly attempt?: number;
}

export interface CompletedRowModel {
	readonly label: string;
	readonly status: string;
	readonly message: string;
	readonly ago: string;
	readonly tone: ActivityTone;
	readonly url?: string;
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
	readonly completed: readonly CompletedRowModel[];
	readonly activity: readonly ActivityRowModel[];
}

const countFormatter = new Intl.NumberFormat("en-US");
export const formatCount = (value: number) => countFormatter.format(value);

export const formatTokens = (value: number) => {
	if (value < 1000) return String(value);
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}m`;
};

export const formatCost = (value: number) =>
	`$${value.toFixed(value < 1 ? 4 : 2)}`;

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

const sparkChars = "▁▂▃▄▅▆▇█";
const throughputWindowMs = 60 * 1000;
const throughputBuckets = 8;

const tokenThroughput = (
	samples: DashboardProjection["tokenSamples"],
	nowMs: number,
) => {
	const windowStart = nowMs - throughputWindowMs;
	const recent = samples.filter((sample) => sample.atMs >= windowStart);
	if (recent.length < 2)
		return { rate: 0, graph: sparkChars[0]?.repeat(throughputBuckets) ?? "" };
	const first = recent[0];
	const last = recent[recent.length - 1];
	if (first === undefined || last === undefined || last.atMs <= first.atMs)
		return { rate: 0, graph: sparkChars[0]?.repeat(throughputBuckets) ?? "" };
	const rate = ((last.tokens - first.tokens) * 1000) / (last.atMs - first.atMs);
	const bucketMs = throughputWindowMs / throughputBuckets;
	const tokensAtOrBefore = (atMs: number) =>
		recent.findLast((sample) => sample.atMs <= atMs)?.tokens ?? first.tokens;
	const buckets = Array.from({ length: throughputBuckets }, (_, index) => {
		const start = windowStart + index * bucketMs;
		const end = start + bucketMs;
		return Math.max(0, tokensAtOrBefore(end) - tokensAtOrBefore(start));
	});
	const max = Math.max(...buckets, 1);
	const graph = buckets
		.map(
			(value) =>
				sparkChars[Math.ceil((value / max) * (sparkChars.length - 1))] ??
				sparkChars[0],
		)
		.join("");
	return { rate, graph };
};

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
	activity: work.lastMeaningful,
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
	const throughput = tokenThroughput(projection.tokenSamples, nowMs);
	const totalTokens = formatTokens(projection.usageTotals.tokens);
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
			...(projection.runtime.maxConcurrentRuns === undefined
				? {}
				: { maxConcurrentRuns: projection.runtime.maxConcurrentRuns }),
			totalTokens,
			...(projection.usageTotals.cost === undefined
				? {}
				: { totalCost: formatCost(projection.usageTotals.cost) }),
			throughput: `${formatTokens(Math.round(throughput.rate))} tps`,
			throughputGraph: throughput.graph,
		},
		attention: attentionFrom(rows, projection.diagnostics),
		work: rows,
		scheduled: projection.scheduledWakes.slice(0, 5).map((wake) => {
			const work =
				wake.workKey === undefined
					? undefined
					: projection.running.get(wake.workKey);
			return {
				inSeconds: Math.ceil(Math.max(0, wake.dueAtMs - nowMs) / 1000),
				...(wake.reason === undefined ? {} : { reason: wake.reason }),
				...(wake.workKey === undefined ? {} : { workKey: wake.workKey }),
				...(work === undefined ? {} : { label: workLabel(work) }),
				...(wake.attempt === undefined ? {} : { attempt: wake.attempt }),
			};
		}),
		completed: projection.completed.slice(0, 5).map((entry) => ({
			label: entry.label,
			status: entry.status,
			message: entry.message,
			ago: formatAgo(nowMs - entry.atMs),
			tone: entry.status === "succeeded" ? "ok" : "bad",
			...(entry.url === undefined ? {} : { url: entry.url }),
		})),
		activity: projection.activity.slice(0, 20).map((entry) => ({
			ago: formatAgo(nowMs - entry.atMs),
			tone: entry.tone,
			text: entry.text,
		})),
	};
};
