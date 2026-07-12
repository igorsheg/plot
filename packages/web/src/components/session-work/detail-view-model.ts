/**
 * Pure view-model for the work-detail drawer — no React. `buildDetail` resolves
 * an open reference against the projection into a `DetailView` discriminated
 * union (decision | held | active | settled | failed) carrying exactly the fields
 * the drawer sections render. `openableRefs` + `stepRef` drive the ↑/↓ walker;
 * every builder here is unit-tested in isolation.
 */

import {
	workLabel,
	type CompletedWorkProjection,
	type SerializedDashboardProjection,
	type SourceProjection,
	type SourceReadiness,
	type TimelineEntry,
	type TokenUsageProjection,
	type WorkCheck,
} from "@plot/projection";
import { formatDuration, formatShortAge } from "../../lib/relative-time.js";
import {
	parseOperatorActions,
	type AttentionItem,
	type LiveLine,
	type MotionItem,
	type OperatorActionView,
	type SettledItem,
} from "./view-model.js";

export type DetailRef =
	| { readonly kind: "work"; readonly workKey: string }
	| { readonly kind: "settled"; readonly key: string }
	| { readonly kind: "source"; readonly sourceId: string };

/** The minimal slice `DecisionActions` needs in the drawer. */
export interface DecisionActionTarget {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actions: readonly OperatorActionView[];
}

/** One requirement in a source drawer — its own status, message, and actions. */
export interface SourceRequirementView {
	readonly id: string;
	readonly label: string;
	readonly status: SourceReadiness;
	readonly message?: string | undefined;
	readonly actions: readonly OperatorActionView[];
}

/** The footer ledger — turn, tokens, cost, elapsed; each part is optional. */
export interface DetailMetrics {
	readonly turn: number;
	readonly tokens: number | undefined;
	readonly cost: number | undefined;
	readonly elapsed: string | undefined;
}

interface DetailCommon {
	readonly ref: DetailRef;
	readonly title: string;
	readonly subtitle: string | undefined;
	readonly labels: readonly string[];
	readonly url: string | undefined;
	readonly stage: string;
	readonly check: WorkCheck | undefined;
	readonly metrics: DetailMetrics;
	readonly events: readonly TimelineEntry[];
}

export type DetailView =
	| (DetailCommon & {
			readonly kind: "decision";
			readonly reason: string | undefined;
			readonly decision: DecisionActionTarget;
	  })
	| (DetailCommon & {
			readonly kind: "held";
			readonly reason: string | undefined;
			readonly decision: DecisionActionTarget | undefined;
	  })
	| (DetailCommon & {
			readonly kind: "active";
			readonly narrative: LiveLine | undefined;
	  })
	| (DetailCommon & { readonly kind: "settled"; readonly message: string })
	| (DetailCommon & { readonly kind: "failed"; readonly message: string })
	| {
			readonly kind: "source";
			readonly ref: DetailRef;
			readonly sourceId: string;
			readonly title: string;
			readonly status: "action-required" | "unavailable";
			readonly requirements: readonly SourceRequirementView[];
			readonly diagnostics: readonly string[];
			readonly action?:
				| {
						readonly actionRunId: string;
						readonly requirementId: string;
						readonly status: "running" | "failed" | "cancelled";
						readonly progress?: string | undefined;
				  }
				| undefined;
	  };

const workRef = (workKey: string): DetailRef => ({ kind: "work", workKey });

/** Composite key mirroring `buildSettled`, so a settled ref matches a row. */
export const settledKey = (item: CompletedWorkProjection): string =>
	`${item.workKey}:${item.runId ?? "run"}:${item.atMs}`;

/** `118k` / `1.2m` / `640` — coarse token counts for the footer facts line. */
export const formatTokens = (n: number): string => {
	if (n < 1000) return `${n}`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	const millions = (n / 1_000_000).toFixed(1);
	return `${millions.endsWith(".0") ? millions.slice(0, -2) : millions}m`;
};

const tokenTotal = (tokens?: TokenUsageProjection): number | undefined => {
	if (tokens === undefined) return undefined;
	if (tokens.total !== undefined) return tokens.total;
	if (tokens.input === undefined && tokens.output === undefined)
		return undefined;
	return (tokens.input ?? 0) + (tokens.output ?? 0);
};

/** `not-run` and absent both read as "no check to show". */
const normalizeCheck = (check: WorkCheck | undefined): WorkCheck | undefined =>
	check === undefined || check === "not-run" ? undefined : check;

const sinceAge = (
	sinceMs: number | undefined,
	nowMs: number,
): string | undefined =>
	sinceMs === undefined ? undefined : formatShortAge(nowMs - sinceMs);

const metricsOf = (input: {
	readonly turn: number | undefined;
	readonly tokens: number | undefined;
	readonly cost: number | undefined;
	readonly elapsed: string | undefined;
}): DetailMetrics => ({
	turn: input.turn ?? 0,
	tokens: input.tokens,
	cost: input.cost,
	elapsed: input.elapsed,
});

/** Chronological, capped to the newest 30 (terminal convention: newest last). */
export const capTimeline = (
	entries: readonly TimelineEntry[],
): readonly TimelineEntry[] =>
	entries.length > 30 ? entries.slice(-30) : entries;

const attemptOf = (
	projection: SerializedDashboardProjection,
	runId: string | undefined,
): SerializedDashboardProjection["attempts"][string] | undefined =>
	runId === undefined ? undefined : projection.attempts[runId];

const timelineOf = (
	attempt: SerializedDashboardProjection["attempts"][string] | undefined,
): readonly TimelineEntry[] =>
	attempt === undefined
		? []
		: capTimeline(
				attempt.timeline.map((entry) => ({
					kind: entry.kind,
					text: entry.text,
					atMs: entry.atMs,
				})),
			);

const activeNarrativeOf = (
	attempt: SerializedDashboardProjection["attempts"][string] | undefined,
): LiveLine | undefined => {
	if (attempt?.streams.message !== undefined)
		return { text: attempt.streams.message, llm: true };
	if (attempt?.streams.thinking !== undefined)
		return { text: attempt.streams.thinking, llm: true };
	if (attempt?.lastNarrative !== undefined)
		return { text: attempt.lastNarrative.text, llm: true };
	return undefined;
};

const identityOf = (
	work: SerializedDashboardProjection["work"][string],
): Pick<DetailCommon, "subtitle" | "labels" | "url"> => ({
	subtitle: work.subtitle,
	labels: work.labels,
	url: work.url,
});

const buildWorkDetail = (
	projection: SerializedDashboardProjection,
	work: SerializedDashboardProjection["work"][string],
	nowMs: number,
): DetailView | undefined => {
	const attempt = attemptOf(projection, work.currentRunId);
	const title = workLabel(work);
	const events = timelineOf(attempt);
	const identity = identityOf(work);
	const tokens = tokenTotal(attempt?.tokens);
	const cost = attempt?.tokens?.cost;
	const turn = attempt?.turnCount;
	const check = normalizeCheck(attempt?.check);
	const ref = workRef(work.workKey);
	if (work.status === "running" || work.status === "draining") {
		return {
			kind: "active",
			ref,
			title,
			...identity,
			stage: "working",
			check,
			metrics: metricsOf({
				turn,
				tokens,
				cost,
				elapsed: sinceAge(attempt?.startedAtMs, nowMs),
			}),
			events,
			narrative: activeNarrativeOf(attempt),
		};
	}
	if (work.status === "blocked") {
		return {
			kind: "decision",
			ref,
			title,
			...identity,
			stage: "blocked",
			check,
			metrics: metricsOf({
				turn,
				tokens,
				cost,
				elapsed: sinceAge(attempt?.lastEventAtMs, nowMs),
			}),
			events,
			reason: work.blockedReason,
			decision: {
				sourceId: work.sourceId,
				workKey: work.workKey,
				actions: parseOperatorActions(work.operatorActions),
			},
		};
	}
	if (work.status === "waiting") {
		const actions = parseOperatorActions(work.operatorActions);
		return {
			kind: "held",
			ref,
			title,
			...identity,
			stage: "waiting",
			check,
			metrics: metricsOf({
				turn,
				tokens,
				cost,
				elapsed: sinceAge(attempt?.lastEventAtMs, nowMs),
			}),
			events,
			reason: work.blockedReason,
			decision:
				actions.length === 0
					? undefined
					: {
							sourceId: work.sourceId,
							workKey: work.workKey,
							actions,
						},
		};
	}
	return undefined;
};

const buildSettledDetail = (
	projection: SerializedDashboardProjection,
	item: CompletedWorkProjection,
): DetailView => {
	const attempt = attemptOf(projection, item.runId);
	const events = timelineOf(attempt);
	const failed = item.status !== "succeeded" && item.status !== "done";
	const usage = item.tokens ?? attempt?.tokens;
	const common: DetailCommon = {
		ref: { kind: "settled", key: settledKey(item) },
		title: item.label,
		subtitle: undefined,
		labels: item.labels ?? [],
		url: item.url,
		stage: failed ? `run ${item.status}` : "run succeeded",
		check: normalizeCheck(attempt?.check),
		metrics: metricsOf({
			turn: attempt?.turnCount,
			tokens: tokenTotal(usage),
			cost: usage?.cost,
			elapsed:
				item.durationMs === undefined
					? undefined
					: formatDuration(item.durationMs),
		}),
		events,
	};
	return failed
		? { ...common, kind: "failed", message: item.message }
		: { ...common, kind: "settled", message: item.message };
};

/**
 * A source drawer resolves regardless of readiness, so the panel survives the
 * transition to `ready` (requirements then read as ready). `checking`/`ready`
 * collapse to `action-required` for the status field — the header's all-ready
 * check wins over it, so the value is never shown when the source is settled.
 */
const buildSourceDetail = (source: SourceProjection): DetailView => ({
	kind: "source",
	ref: { kind: "source", sourceId: source.sourceId },
	sourceId: source.sourceId,
	title: source.label,
	status:
		source.readiness === "unavailable" ? "unavailable" : "action-required",
	requirements: source.requirements.map((requirement) => ({
		id: requirement.id,
		label: requirement.label,
		status: requirement.status,
		message: requirement.message,
		actions: parseOperatorActions(requirement.actions),
	})),
	diagnostics: source.diagnostics,
	action:
		source.action === undefined
			? undefined
			: {
					actionRunId: source.action.actionRunId,
					requirementId: source.action.requirementId,
					status: source.action.status,
					progress: source.action.progress,
				},
});

/**
 * Resolve an open reference into a detail view. A `work` reference that has
 * settled out of the live map is followed into `completed` by its workKey, so
 * the drawer stays open across the settle transition; unresolvable → undefined.
 */
export const buildDetail = (
	projection: SerializedDashboardProjection,
	ref: DetailRef,
	nowMs: number,
): DetailView | undefined => {
	if (ref.kind === "source") {
		const source = projection.sources[ref.sourceId];
		return source === undefined ? undefined : buildSourceDetail(source);
	}
	if (ref.kind === "settled") {
		const item = projection.completed.find((c) => settledKey(c) === ref.key);
		return item === undefined
			? undefined
			: buildSettledDetail(projection, item);
	}
	const work = projection.work[ref.workKey];
	if (work !== undefined) return buildWorkDetail(projection, work, nowMs);
	const done = projection.completed.find((c) => c.workKey === ref.workKey);
	return done === undefined ? undefined : buildSettledDetail(projection, done);
};

export const refEquals = (a: DetailRef, b: DetailRef): boolean => {
	if (a.kind === "work" && b.kind === "work") return a.workKey === b.workKey;
	if (a.kind === "settled" && b.kind === "settled") return a.key === b.key;
	if (a.kind === "source" && b.kind === "source")
		return a.sourceId === b.sourceId;
	return false;
};

/**
 * Openable references in river order: attention (sources + decisions +
 * failures) → motion (active + actionable held) → settled. Queued, passive
 * held, and diagnostic rows are not openable.
 */
export const openableRefs = (input: {
	readonly attention: readonly AttentionItem[];
	readonly motion: readonly MotionItem[];
	readonly settled: readonly SettledItem[];
}): readonly DetailRef[] => {
	const refs: DetailRef[] = [];
	for (const item of input.attention) {
		if (item.kind === "source")
			refs.push({ kind: "source", sourceId: item.sourceId });
		else if (item.kind === "decision" || item.kind === "failure")
			refs.push(workRef(item.key));
	}
	for (const item of input.motion) {
		if (
			item.kind === "active" ||
			(item.kind === "held" && item.actions.length > 0)
		)
			refs.push(workRef(item.key));
	}
	for (const item of input.settled)
		refs.push({ kind: "settled", key: item.key });
	return refs;
};

/** Walk to the previous/next openable ref. Clamps at both ends (no wrap). */
export const stepRef = (
	refs: readonly DetailRef[],
	current: DetailRef | undefined,
	direction: 1 | -1,
): DetailRef | undefined => {
	if (refs.length === 0) return undefined;
	const index =
		current === undefined ? -1 : refs.findIndex((r) => refEquals(r, current));
	if (index === -1) return refs[0];
	const next = Math.min(refs.length - 1, Math.max(0, index + direction));
	return refs[next];
};
