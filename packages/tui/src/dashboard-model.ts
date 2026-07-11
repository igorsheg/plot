import {
	workLabel,
	type ActivityTone,
	type AgentAttemptProjection,
	type DashboardProjection,
	type WorkItemProjection,
	type WorkStatus,
} from "@plot/projection";

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
export interface SourceActionModel {
	readonly id: string;
	readonly label: string;
	readonly disabled: boolean;
}
export interface SourceRowModel {
	readonly sourceId: string;
	readonly requirementId?: string | undefined;
	readonly label: string;
	readonly readiness: "checking" | "ready" | "action-required" | "unavailable";
	readonly message?: string | undefined;
	readonly actions: readonly SourceActionModel[];
	readonly actionRunId?: string | undefined;
	readonly progress?: string | undefined;
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
	readonly sources: readonly SourceRowModel[];
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
const throughputBucketsFor = (input: {
	readonly samples: readonly {
		readonly atMs: number;
		readonly tokens: number;
	}[];
	readonly windowStart: number;
	readonly bucketMs: number;
}) => {
	const buckets = Array.from({ length: throughputBuckets }, () => 0);
	for (let i = 1; i < input.samples.length; i++) {
		const previous = input.samples[i - 1];
		const current = input.samples[i];
		if (previous === undefined || current === undefined) continue;
		const delta = current.tokens - previous.tokens;
		const duration = current.atMs - previous.atMs;
		if (delta <= 0 || duration <= 0) continue;
		const segmentStart = Math.max(previous.atMs, input.windowStart);
		const segmentEnd = current.atMs;
		if (segmentEnd <= segmentStart) continue;
		for (let bucket = 0; bucket < throughputBuckets; bucket++) {
			const bucketStart = input.windowStart + bucket * input.bucketMs;
			const bucketEnd = bucketStart + input.bucketMs;
			const overlap = Math.max(
				0,
				Math.min(segmentEnd, bucketEnd) - Math.max(segmentStart, bucketStart),
			);
			if (overlap > 0)
				buckets[bucket] = (buckets[bucket] ?? 0) + delta * (overlap / duration);
		}
	}
	return buckets;
};
const throughput = (projection: DashboardProjection, nowMs: number) => {
	const windowStart = nowMs - throughputWindowMs;
	const recent = projection.tokenSamples.filter((s) => s.atMs >= windowStart);
	if (recent.length < 2) return emptyThroughput();
	const first = recent[0],
		last = recent.at(-1);
	if (!first || !last || last.atMs <= first.atMs) return emptyThroughput();
	const rate = ((last.tokens - first.tokens) * 1000) / (last.atMs - first.atMs);
	const bucketMs = throughputWindowMs / throughputBuckets;
	const buckets = throughputBucketsFor({
		samples: recent,
		windowStart,
		bucketMs,
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
	if (
		(work.status === "blocked" || work.status === "waiting") &&
		work.blockedReason
	)
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
		attempt,
		label: workLabel(work),
		status: work.status,
		meta: [age, tokens, check].filter(Boolean).join(" · "),
		activity: displayActivity(work, attempt),
		lastEventAgo:
			attempt?.lastEventAtMs === undefined
				? ""
				: formatAgo(nowMs - attempt.lastEventAtMs),
		stale,
		attention: work.status === "blocked",
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
	const pulse: PulseModel = {
		tick: projection.pulse
			? {
					id: projection.pulse.tickId,
					ago: formatAgo(nowMs - projection.pulse.atMs),
					found: projection.pulse.found,
					started: projection.pulse.started,
				}
			: undefined,
		nextTick:
			projection.pulse &&
			tickIntervalMs !== undefined &&
			projection.status !== "stopped" &&
			projection.status !== "shutting_down"
				? {
						inSeconds: Math.ceil(
							Math.max(0, projection.pulse.atMs + tickIntervalMs - nowMs) /
								1000,
						),
					}
				: undefined,
		nextWake: nextWake
			? {
					inSeconds: Math.ceil(Math.max(0, nextWake.dueAtMs - nowMs) / 1000),
					kind: nextWake.workKey ? "retry" : "wake",
					reason: nextWake.reason,
				}
			: undefined,
		runningCount: projection.attempts.size,
		maxConcurrentRuns: projection.runtime.maxConcurrentRuns,
		totalTokens: formatTokens(projection.usageTotals.tokens),
		totalCost:
			projection.usageTotals.cost === undefined
				? undefined
				: formatCost(projection.usageTotals.cost),
		throughput: `${formatTokens(Math.round(tokenThroughput.rate))} tok/s`,
		throughputGraph: tokenThroughput.graph,
	};
	return {
		pulse,
		sources: [...projection.sources.values()]
			.filter((source) => source.readiness !== "ready")
			.map((source) => {
				const requirement = source.requirements.find(
					(item) => item.status !== "ready",
				);
				return {
					sourceId: source.sourceId,
					label: source.label,
					readiness: source.readiness,
					message: requirement?.message ?? source.message,
					requirementId: requirement?.id,
					actions: (requirement?.actions ?? []).flatMap((action) => {
						if (typeof action !== "object" || action === null) return [];
						const value = action as {
							readonly id?: unknown;
							readonly label?: unknown;
							readonly disabledReason?: unknown;
						};
						if (typeof value.id !== "string" || typeof value.label !== "string")
							return [];
						return [
							{
								id: value.id,
								label: value.label,
								disabled: typeof value.disabledReason === "string",
							},
						];
					}),
					actionRunId: source.action?.actionRunId,
					progress: source.action?.progress,
				};
			})
			.toSorted((a, b) => a.label.localeCompare(b.label)),
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
		scheduled: projection.scheduledWakes.slice(0, 5).map((wake) => {
			const item = wake.workKey ? projection.work.get(wake.workKey) : undefined;
			return {
				inSeconds: Math.ceil(Math.max(0, wake.dueAtMs - nowMs) / 1000),
				reason: wake.reason,
				workKey: wake.workKey,
				label: item ? workLabel(item) : undefined,
				attempt: wake.attempt,
			};
		}),
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
				meta: meta || undefined,
				tone: entry.status === "succeeded" ? "ok" : "bad",
				url: entry.url,
			};
		}),
	};
};
