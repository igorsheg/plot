import {
	workLabel,
	type ActivityTone,
	type AgentAttemptProjection,
	type DashboardProjection,
	type WorkItemProjection,
	type WorkStatus,
} from "@plot/session/projection";

export interface PulseTickModel {
	readonly id: number;
	readonly ago: string;
	readonly found: number;
	readonly started: number;
}
export interface PulseNextWakeModel {
	readonly inSeconds: number;
	readonly kind?: "wake" | "retry";
	readonly reason?: string | undefined;
}
export interface PulseModel {
	readonly tick?: PulseTickModel | undefined;
	readonly nextTick?: PulseNextWakeModel | undefined;
	readonly nextWake?: PulseNextWakeModel | undefined;
	readonly runningCount: number;
	readonly maxConcurrentRuns?: number | undefined;
	readonly totalTokens: string;
	readonly totalCost?: string | undefined;
	readonly throughput: string;
	readonly throughputGraph: string;
}
export interface AttentionItemModel {
	readonly workKey?: string | undefined;
	readonly text: string;
}
export interface WorkRowModel {
	readonly work: WorkItemProjection;
	readonly attempt?: AgentAttemptProjection | undefined;
	readonly label: string;
	readonly status: WorkStatus;
	readonly meta: string;
	readonly activity: string;
	readonly lastEventAgo: string;
	readonly stale: boolean;
	readonly attention: boolean;
}
export interface ScheduledRowModel {
	readonly inSeconds: number;
	readonly reason?: string | undefined;
	readonly workKey?: string | undefined;
	readonly label?: string | undefined;
	readonly attempt?: number | undefined;
}
export interface CompletedRowModel {
	readonly label: string;
	readonly status: string;
	readonly message: string;
	readonly ago: string;
	readonly meta?: string | undefined;
	readonly tone: ActivityTone;
	readonly url?: string | undefined;
}
export interface DashboardModel {
	readonly pulse: PulseModel;
	readonly attention: readonly AttentionItemModel[];
	readonly work: readonly WorkRowModel[];
	readonly scheduled: readonly ScheduledRowModel[];
	readonly completed: readonly CompletedRowModel[];
}

export const formatTokens = (value: number) =>
	value < 1000
		? String(value)
		: value < 1_000_000
			? `${(value / 1000).toFixed(1)}k`
			: `${(value / 1_000_000).toFixed(1)}m`;
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

const tokenMeta = (tokens: AgentAttemptProjection["tokens"] | undefined) => {
	const total = tokens?.total ?? 0;
	if (total === 0) return undefined;
	return `${formatTokens(total)} tok${tokens?.cost === undefined || tokens.cost === 0 ? "" : ` · ${formatCost(tokens.cost)}`}`;
};
const sparkChars = "▁▂▃▄▅▆▇█";
const throughputWindowMs = 60 * 1000;
const throughputBuckets = 8;
const emptyThroughput = () => ({
	rate: 0,
	graph: sparkChars[0]?.repeat(throughputBuckets) ?? "",
});
const throughput = (projection: DashboardProjection, nowMs: number) => {
	const windowStart = nowMs - throughputWindowMs;
	const recent = projection.tokenSamples.filter((s) => s.atMs >= windowStart);
	if (recent.length < 2) return emptyThroughput();
	const first = recent[0],
		last = recent.at(-1);
	if (!first || !last || last.atMs <= first.atMs) return emptyThroughput();
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
const displayActivity = (
	work: WorkItemProjection,
	attempt: AgentAttemptProjection | undefined,
) => {
	if (work.status === "blocked" && work.blockedReason)
		return work.blockedReason;
	if (!attempt) return work.status;
	return (
		attempt.streams.tool ??
		attempt.streams.message ??
		attempt.streams.thinking ??
		attempt.activity ??
		attempt.lastDisplay
	).trim();
};
const workRow = (
	work: WorkItemProjection,
	attempt: AgentAttemptProjection | undefined,
	nowMs: number,
): WorkRowModel => {
	const age =
		attempt?.startedAtMs === undefined
			? work.status
			: formatDuration(nowMs - attempt.startedAtMs);
	const tokens = tokenMeta(attempt?.tokens);
	const check =
		attempt?.check === "running"
			? "checking"
			: attempt?.check === "failed"
				? "check failed"
				: attempt?.check === "passed"
					? "check passed"
					: undefined;
	const stale =
		attempt?.lastEventAtMs !== undefined &&
		nowMs - attempt.lastEventAtMs > 120_000;
	return {
		work,
		...(attempt ? { attempt } : {}),
		label: workLabel(work),
		status: work.status,
		meta: [age, tokens, check].filter(Boolean).join(" · "),
		activity: displayActivity(work, attempt),
		lastEventAgo:
			attempt?.lastEventAtMs === undefined
				? ""
				: formatAgo(nowMs - attempt.lastEventAtMs),
		stale,
		attention: work.status === "blocked" || work.status === "failed",
	};
};
const shortRunId = (runId: string | undefined) =>
	runId === undefined
		? undefined
		: runId.length <= 12
			? runId
			: `${runId.slice(0, 8)}…${runId.slice(-4)}`;

export const dashboardModelFrom = (
	projection: DashboardProjection,
	nowMs = Date.now(),
): DashboardModel => {
	const work = [...projection.work.values()]
		.filter((w) => w.status !== "done")
		.map((w) =>
			workRow(
				w,
				w.currentRunId ? projection.attempts.get(w.currentRunId) : undefined,
				nowMs,
			),
		)
		.toSorted(
			(a, b) =>
				Number(b.attention) - Number(a.attention) ||
				(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
		);
	const tickIntervalMs = projection.runtime.tickIntervalMs;
	const nextWake = projection.scheduledWakes[0];
	const tokenThroughput = throughput(projection, nowMs);
	const duplicateLabels = new Set(
		projection.completed
			.map((c) => c.label)
			.filter((label, _i, xs) => xs.filter((x) => x === label).length > 1),
	);
	return {
		pulse: {
			...(projection.pulse
				? {
						tick: {
							id: projection.pulse.tickId,
							ago: formatAgo(nowMs - projection.pulse.atMs),
							found: projection.pulse.found,
							started: projection.pulse.started,
						},
					}
				: {}),
			...(projection.pulse &&
			tickIntervalMs !== undefined &&
			projection.status !== "stopped" &&
			projection.status !== "shutting_down"
				? {
						nextTick: {
							inSeconds: Math.ceil(
								Math.max(0, projection.pulse.atMs + tickIntervalMs - nowMs) /
									1000,
							),
						},
					}
				: {}),
			...(nextWake
				? {
						nextWake: {
							inSeconds: Math.ceil(
								Math.max(0, nextWake.dueAtMs - nowMs) / 1000,
							),
							kind: nextWake.workKey ? ("retry" as const) : ("wake" as const),
							...(nextWake.reason ? { reason: nextWake.reason } : {}),
						},
					}
				: {}),
			runningCount: projection.attempts.size,
			...(projection.runtime.maxConcurrentRuns === undefined
				? {}
				: { maxConcurrentRuns: projection.runtime.maxConcurrentRuns }),
			totalTokens: formatTokens(projection.usageTotals.tokens),
			...(projection.usageTotals.cost === undefined
				? {}
				: { totalCost: formatCost(projection.usageTotals.cost) }),
			throughput: `${formatTokens(Math.round(tokenThroughput.rate))} tok/s`,
			throughputGraph: tokenThroughput.graph,
		},
		attention: [
			...work
				.filter((w) => w.attention)
				.map((w) => ({
					workKey: w.work.workKey,
					text: `${w.label} ${w.status} · ${w.activity}${w.lastEventAgo ? ` · ${w.lastEventAgo}` : ""}`,
				})),
			...work
				.filter((w) => w.stale && !w.attention)
				.map((w) => ({
					workKey: w.work.workKey,
					text: `${w.label} stale · last event ${w.lastEventAgo}`,
				})),
			...projection.diagnostics.map((text) => ({ text })),
		],
		work,
		scheduled: projection.scheduledWakes.slice(0, 5).map((wake) => ({
			inSeconds: Math.ceil(Math.max(0, wake.dueAtMs - nowMs) / 1000),
			...(wake.reason ? { reason: wake.reason } : {}),
			...(wake.workKey
				? {
						workKey: wake.workKey,
						label: projection.work.get(wake.workKey)
							? workLabel(projection.work.get(wake.workKey)!)
							: undefined,
					}
				: {}),
			...(wake.attempt === undefined ? {} : { attempt: wake.attempt }),
		})),
		completed: projection.completed.slice(0, 5).map((entry) => {
			const meta = [
				entry.durationMs === undefined
					? undefined
					: formatDuration(entry.durationMs),
				tokenMeta(entry.tokens),
				duplicateLabels.has(entry.label)
					? `run ${shortRunId(entry.runId)}`
					: undefined,
			]
				.filter(Boolean)
				.join(" · ");
			return {
				label: entry.label,
				status: entry.status,
				message: entry.message,
				ago: formatAgo(nowMs - entry.atMs),
				...(meta ? { meta } : {}),
				tone: entry.status === "succeeded" ? ("ok" as const) : ("bad" as const),
				...(entry.url ? { url: entry.url } : {}),
			};
		}),
	};
};
