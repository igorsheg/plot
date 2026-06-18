import { z } from "zod";
import {
	activityToneSchema,
	agentAttemptProjectionSchema,
	workItemProjectionSchema,
	workLabel,
	workStatusSchema,
	type AgentAttemptProjection,
	type DashboardProjection,
	type WorkItemProjection,
	type WorkStatus,
} from "./projection.js";
import { nonNegativeIntegerSchema } from "./session-summary.js";

export const pulseTickModelSchema = z
	.object({
		id: nonNegativeIntegerSchema,
		ago: z.string(),
		found: nonNegativeIntegerSchema,
		started: nonNegativeIntegerSchema,
	})
	.strict();
export type PulseTickModel = z.infer<typeof pulseTickModelSchema>;

export const pulseNextWakeModelSchema = z
	.object({
		inSeconds: nonNegativeIntegerSchema,
		kind: z.enum(["wake", "retry"]).optional(),
		reason: z.string().optional(),
	})
	.strict();
export type PulseNextWakeModel = z.infer<typeof pulseNextWakeModelSchema>;

export const pulseModelSchema = z
	.object({
		tick: pulseTickModelSchema.optional(),
		nextTick: pulseNextWakeModelSchema.optional(),
		nextWake: pulseNextWakeModelSchema.optional(),
		runningCount: nonNegativeIntegerSchema,
		maxConcurrentRuns: nonNegativeIntegerSchema.optional(),
		totalTokens: z.string(),
		totalCost: z.string().optional(),
		throughput: z.string(),
		throughputGraph: z.string(),
	})
	.strict();
export type PulseModel = z.infer<typeof pulseModelSchema>;

export const attentionItemModelSchema = z
	.object({
		workKey: z.string().optional(),
		text: z.string(),
	})
	.strict();
export type AttentionItemModel = z.infer<typeof attentionItemModelSchema>;

export const workRowModelSchema = z
	.object({
		work: workItemProjectionSchema,
		attempt: agentAttemptProjectionSchema.optional(),
		label: z.string(),
		status: workStatusSchema,
		meta: z.string(),
		activity: z.string(),
		lastEventAgo: z.string(),
		stale: z.boolean(),
		attention: z.boolean(),
	})
	.strict();
export type WorkRowModel = z.infer<typeof workRowModelSchema>;

export const scheduledRowModelSchema = z
	.object({
		inSeconds: nonNegativeIntegerSchema,
		reason: z.string().optional(),
		workKey: z.string().optional(),
		label: z.string().optional(),
		attempt: nonNegativeIntegerSchema.optional(),
	})
	.strict();
export type ScheduledRowModel = z.infer<typeof scheduledRowModelSchema>;

export const completedRowModelSchema = z
	.object({
		label: z.string(),
		status: z.string(),
		message: z.string(),
		ago: z.string(),
		meta: z.string().optional(),
		tone: activityToneSchema,
		url: z.string().optional(),
	})
	.strict();
export type CompletedRowModel = z.infer<typeof completedRowModelSchema>;

export const dashboardModelSchema = z
	.object({
		pulse: pulseModelSchema,
		attention: z.array(attentionItemModelSchema).readonly(),
		work: z.array(workRowModelSchema).readonly(),
		scheduled: z.array(scheduledRowModelSchema).readonly(),
		completed: z.array(completedRowModelSchema).readonly(),
	})
	.strict();
export type DashboardModel = z.infer<typeof dashboardModelSchema>;

export const safeParseDashboardModel = (value: unknown) =>
	dashboardModelSchema.safeParse(value);

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

const needsAttention = (status: WorkStatus) =>
	status === "blocked" || status === "failed";

const isStale = (attempt: AgentAttemptProjection | undefined, nowMs: number) =>
	attempt?.lastEventAtMs !== undefined &&
	nowMs - attempt.lastEventAtMs > staleThresholdMs;

// `activity` is already churn-resolved at reduce time (projection.ts), so the
// view model renders it verbatim — falling back to the last meaningful action
// only when the run hasn't produced a live line yet.
const displayActivity = (
	work: WorkItemProjection,
	attempt: AgentAttemptProjection | undefined,
) => {
	if (work.status === "blocked" && work.blockedReason !== undefined)
		return work.blockedReason;
	if (attempt === undefined) return work.status;
	const stream = attempt.streaming
		? (attempt.streams.tool ??
			attempt.streams.message ??
			(attempt.streams.thinking === undefined
				? undefined
				: `Thinking · ${attempt.streams.thinking}`))
		: undefined;
	const activity = (stream ?? attempt.activity).trim();
	return activity.length === 0 ? attempt.lastMeaningful : activity;
};

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

const shortRunId = (runId: string | undefined) => {
	if (runId === undefined) return undefined;
	if (runId.length <= 12) return runId;
	return `${runId.slice(0, 8)}…${runId.slice(-4)}`;
};

const tokenMeta = (tokens: AgentAttemptProjection["tokens"] | undefined) => {
	const total = tokens?.total ?? 0;
	if (total === 0) return undefined;
	return `${formatTokens(total)} tok${tokens?.cost === undefined || tokens.cost === 0 ? "" : ` · ${formatCost(tokens.cost)}`}`;
};

const workRow = (
	work: WorkItemProjection,
	attempt: AgentAttemptProjection | undefined,
	nowMs: number,
): WorkRowModel => {
	const age =
		attempt?.startedAtMs === undefined
			? "n/a"
			: formatDuration(nowMs - attempt.startedAtMs);
	const token = tokenMeta(attempt?.tokens);
	const check =
		attempt?.check === "running"
			? "checking"
			: attempt?.check === "failed"
				? "check failed"
				: attempt?.check === "passed"
					? "check passed"
					: undefined;
	return {
		work,
		...(attempt === undefined ? {} : { attempt }),
		label: workLabel(work),
		status: work.status,
		meta: [
			attempt === undefined ? work.status : age,
			...(token === undefined ? [] : [token]),
			...(check === undefined ? [] : [check]),
		].join(" · "),
		activity: displayActivity(work, attempt),
		lastEventAgo:
			attempt?.lastEventAtMs === undefined
				? ""
				: formatAgo(nowMs - attempt.lastEventAtMs),
		stale: isStale(attempt, nowMs),
		attention: needsAttention(work.status),
	};
};

const attentionFrom = (
	rows: readonly WorkRowModel[],
	diagnostics: readonly string[],
): readonly AttentionItemModel[] => [
	...rows
		.filter((row) => row.attention)
		.map((row) => ({
			workKey: row.work.workKey,
			text: `${row.label} ${row.status} · ${row.activity}${row.lastEventAgo ? ` · ${row.lastEventAgo}` : ""}`,
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
	const rows = [...projection.work.values()]
		.filter((work) => work.status !== "done")
		.map((work) =>
			workRow(
				work,
				work.currentRunId === undefined
					? undefined
					: projection.attempts.get(work.currentRunId),
				nowMs,
			),
		)
		.toSorted(
			(a, b) =>
				Number(b.attention) - Number(a.attention) ||
				(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
		);
	const throughput = tokenThroughput(projection.tokenSamples, nowMs);
	const totalTokens = formatTokens(projection.usageTotals.tokens);
	const nextWake = projection.scheduledWakes[0];
	const tickIntervalMs = projection.runtime.tickIntervalMs;
	const nextTick =
		projection.pulse === undefined ||
		tickIntervalMs === undefined ||
		projection.status === "stopped" ||
		projection.status === "shutting_down"
			? undefined
			: Math.ceil(
					Math.max(0, projection.pulse.atMs + tickIntervalMs - nowMs) / 1000,
				);
	const recentRuns = projection.completed.slice(0, 5);
	const duplicateLabels = new Set(
		recentRuns
			.map((entry) => entry.label)
			.filter(
				(label, _index, labels) =>
					labels.filter((candidate) => candidate === label).length > 1,
			),
	);
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
			...(nextTick === undefined
				? {}
				: {
						nextTick: {
							inSeconds: nextTick,
						},
					}),
			...(nextWake === undefined
				? {}
				: {
						nextWake: {
							inSeconds: Math.ceil(
								Math.max(0, nextWake.dueAtMs - nowMs) / 1000,
							),
							kind: nextWake.workKey === undefined ? "wake" : "retry",
							...(nextWake.reason === undefined
								? {}
								: { reason: nextWake.reason }),
						},
					}),
			runningCount: projection.attempts.size,
			...(projection.runtime.maxConcurrentRuns === undefined
				? {}
				: { maxConcurrentRuns: projection.runtime.maxConcurrentRuns }),
			totalTokens,
			...(projection.usageTotals.cost === undefined
				? {}
				: { totalCost: formatCost(projection.usageTotals.cost) }),
			throughput: `${formatTokens(Math.round(throughput.rate))} tok/s`,
			throughputGraph: throughput.graph,
		},
		attention: attentionFrom(rows, projection.diagnostics),
		work: rows,
		scheduled: projection.scheduledWakes.slice(0, 5).map((wake) => {
			const work =
				wake.workKey === undefined
					? undefined
					: projection.work.get(wake.workKey);
			return {
				inSeconds: Math.ceil(Math.max(0, wake.dueAtMs - nowMs) / 1000),
				...(wake.reason === undefined ? {} : { reason: wake.reason }),
				...(wake.workKey === undefined ? {} : { workKey: wake.workKey }),
				...(work === undefined ? {} : { label: workLabel(work) }),
				...(wake.attempt === undefined ? {} : { attempt: wake.attempt }),
			};
		}),
		completed: recentRuns.map((entry) => {
			const run = duplicateLabels.has(entry.label)
				? shortRunId(entry.runId)
				: undefined;
			const tokens = tokenMeta(entry.tokens);
			const meta = [
				...(entry.durationMs === undefined
					? []
					: [formatDuration(entry.durationMs)]),
				...(tokens === undefined ? [] : [tokens]),
				...(run === undefined ? [] : [`run ${run}`]),
			].join(" · ");
			return {
				label: entry.label,
				status: entry.status,
				message: entry.message,
				ago: formatAgo(nowMs - entry.atMs),
				...(meta === "" ? {} : { meta }),
				tone: entry.status === "succeeded" ? "ok" : "bad",
				...(entry.url === undefined ? {} : { url: entry.url }),
			};
		}),
	};
};
