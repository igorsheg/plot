import type { OperatorAction } from "@plot/sdk/work-contract";
import {
	workLabel,
	type ActivityTone,
	type AgentAttemptProjection,
	type CompletedWorkProjection,
	type DashboardProjection,
	type ScheduledWakeProjection,
	type SourceProjection,
	type WorkItemProjection,
	type WorkSubjectProjection,
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
export interface PulseModel extends Pick<
	DashboardProjection["runtime"],
	"maxConcurrentRuns"
> {
	readonly tick?: PulseTickModel | undefined;
	readonly nextTick?: PulseNextWakeModel | undefined;
	readonly nextWake?: PulseNextWakeModel | undefined;
	readonly runningCount: number;
	readonly totalTokens: string;
	readonly totalCost?: string | undefined;
	readonly throughput: string;
	readonly throughputGraph: string;
}
export interface AttentionItemModel {
	readonly workKey?: string | undefined;
	readonly text: string;
}
export interface SourceActionModel extends Pick<
	OperatorAction,
	"id" | "label"
> {
	readonly disabled: boolean;
}
export interface SourceRowModel extends Pick<
	SourceProjection,
	"sourceId" | "label" | "readiness" | "message"
> {
	readonly requirementId?: string | undefined;
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
export interface WorkSubjectModel {
	readonly key: string;
	readonly subject: WorkSubjectProjection;
	readonly label: string;
	readonly meta: string;
	readonly work: readonly WorkRowModel[];
}
export interface WorkGroupModel {
	readonly subject?: WorkSubjectModel | undefined;
	readonly work: readonly WorkRowModel[];
}
export interface ScheduledRowModel extends Pick<
	ScheduledWakeProjection,
	"reason" | "workKey" | "attempt"
> {
	readonly inSeconds: number;
	readonly label?: string | undefined;
}
export interface CompletedRowModel extends Pick<
	CompletedWorkProjection,
	"label" | "status" | "message" | "url"
> {
	readonly ago: string;
	readonly meta?: string | undefined;
	readonly tone: ActivityTone;
}
/** Children shown per Subject group in the table; the rest drill down. */
export const maxGroupChildren = 5;

/** Stable identity of a selectable row, immune to re-sorts between renders. */
export type Selection =
	| { readonly kind: "subject"; readonly subjectKey: string }
	| { readonly kind: "work"; readonly workKey: string };

export type TableEntry =
	| { readonly kind: "subject"; readonly subject: WorkSubjectModel }
	| { readonly kind: "work"; readonly row: WorkRowModel };

export const entrySelection = (entry: TableEntry): Selection =>
	entry.kind === "subject"
		? { kind: "subject", subjectKey: entry.subject.key }
		: { kind: "work", workKey: entry.row.work.workKey };

export const entryMatchesSelection = (
	entry: TableEntry,
	selection: Selection,
): boolean =>
	entry.kind === "subject"
		? selection.kind === "subject" && entry.subject.key === selection.subjectKey
		: selection.kind === "work" && entry.row.work.workKey === selection.workKey;

/** Selectable rows in render order: Subject headers + windowed children. */
export const tableEntries = (model: DashboardModel): readonly TableEntry[] =>
	model.workGroups.flatMap((group): TableEntry[] => {
		if (group.subject === undefined)
			return group.work.map((row): TableEntry => ({ kind: "work", row }));
		return [
			{ kind: "subject", subject: group.subject },
			...group.work
				.slice(0, maxGroupChildren)
				.map((row): TableEntry => ({ kind: "work", row })),
		];
	});

export interface DashboardModel {
	readonly pulse: PulseModel;
	readonly sources: readonly SourceRowModel[];
	readonly attention: readonly AttentionItemModel[];
	readonly work: readonly WorkRowModel[];
	readonly workGroups: readonly WorkGroupModel[];
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

const showSubject = (subject: WorkSubjectProjection): boolean =>
	subject.display !== undefined ||
	subject.progress !== undefined ||
	subject.workKeys.length > 1;

const subjectModel = (
	subject: WorkSubjectProjection,
	work: readonly WorkRowModel[],
): WorkSubjectModel => {
	const progress = subject.progress;
	return {
		key: subject.subjectKey,
		subject,
		label: workLabel({
			primary: subject.display?.primary,
			title: subject.display?.title ?? subject.id,
		}),
		meta: [
			subject.display?.subtitle,
			progress === undefined
				? `${work.length} work items`
				: `${progress.completed}/${progress.total} complete`,
			progress?.phase,
		]
			.filter(Boolean)
			.join(" · "),
		work,
	};
};

const groupWork = (
	projection: DashboardProjection,
	rows: readonly WorkRowModel[],
): readonly WorkGroupModel[] => {
	const groups: { subject?: WorkSubjectProjection; work: WorkRowModel[] }[] =
		[];
	const bySubject = new Map<string, (typeof groups)[number]>();
	for (const row of rows) {
		const key = row.work.subjectKey;
		const subject =
			key === undefined ? undefined : projection.subjects.get(key);
		if (subject === undefined || !showSubject(subject)) {
			groups.push({ work: [row] });
			continue;
		}
		const existing = bySubject.get(subject.subjectKey);
		if (existing !== undefined) {
			existing.work.push(row);
			continue;
		}
		const group = { subject, work: [row] };
		groups.push(group);
		bySubject.set(subject.subjectKey, group);
	}
	return groups.map((group) => ({
		work: group.work,
		subject:
			group.subject === undefined
				? undefined
				: subjectModel(group.subject, group.work),
	}));
};

export const dashboardModelFrom = (
	projection: DashboardProjection,
	nowMs = Date.now(),
): DashboardModel => {
	const sortedWork = [...projection.work.values()]
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
				// Rows with a live Attempt before idle ones: the group window keeps
				// the first rows visible, so the front of the list must be what is
				// actually happening.
				Number(a.attempt === undefined) - Number(b.attempt === undefined) ||
				(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
		);
	const workGroups = groupWork(projection, sortedWork);
	const work = workGroups.flatMap((group) => group.work);
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
		workGroups,
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
