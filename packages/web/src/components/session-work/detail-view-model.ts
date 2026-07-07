/**
 * Pure view-model for the work-detail drawer — no React. `buildDetail` resolves
 * an open reference against the projection into a `DetailView` discriminated
 * union (decision | active | settled | failed) carrying exactly the fields the
 * drawer sections render. `openableRefs` + `stepRef` drive the ↑/↓ walker; every
 * builder here is unit-tested in isolation.
 */

import {
	workLabel,
	type CompletedWorkProjection,
	type SerializedDashboardProjection,
	type TimelineEntry,
	type TokenUsageProjection,
	type WorkCheck,
} from "@plot/projection";
import {
	formatDuration,
	formatRelative,
	formatShortAge,
} from "../../lib/relative-time.js";
import {
	parseOperatorActions,
	type AttentionItem,
	type MotionItem,
	type OperatorActionView,
	type SettledItem,
} from "./view-model.js";

export type DetailRef =
	| { readonly kind: "work"; readonly workKey: string }
	| { readonly kind: "settled"; readonly key: string };

/** The minimal slice `DecisionActions` needs in the drawer. */
export interface DecisionActionTarget {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actions: readonly OperatorActionView[];
}

interface DetailCommon {
	readonly ref: DetailRef;
	readonly title: string;
	readonly wordLine: string;
	readonly factsLine: string | undefined;
	readonly attemptRunId: string | undefined;
	readonly timeline: readonly TimelineEntry[];
}

export type DetailView =
	| (DetailCommon & {
			readonly kind: "decision";
			readonly reason: string | undefined;
			readonly decision: DecisionActionTarget;
	  })
	| (DetailCommon & {
			readonly kind: "active";
			readonly tool: string | undefined;
			readonly thinking: string | undefined;
			readonly streaming: boolean;
	  })
	| (DetailCommon & { readonly kind: "settled"; readonly message: string })
	| (DetailCommon & { readonly kind: "failed"; readonly message: string });

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

/** One quiet line: `118k tokens · $0.42 · checks passed`; missing parts omitted. */
export const factsLine = (input: {
	readonly tokens?: number | undefined;
	readonly cost?: number | undefined;
	readonly check?: WorkCheck | undefined;
}): string | undefined => {
	const parts: string[] = [];
	if (input.tokens !== undefined)
		parts.push(`${formatTokens(input.tokens)} tokens`);
	if (input.cost !== undefined) parts.push(`$${input.cost.toFixed(2)}`);
	if (input.check === "passed") parts.push("checks passed");
	else if (input.check === "failed") parts.push("checks failed");
	return parts.length === 0 ? undefined : parts.join(" · ");
};

const withAge = (
	word: string,
	sinceMs: number | undefined,
	nowMs: number,
): string =>
	sinceMs === undefined ? word : `${word} · ${formatShortAge(nowMs - sinceMs)}`;

const activeWordLine = (
	nowMs: number,
	startedAtMs: number | undefined,
	turnCount: number,
): string => {
	const parts = ["running"];
	if (startedAtMs !== undefined)
		parts.push(formatShortAge(nowMs - startedAtMs));
	parts.push(`turn ${turnCount}`);
	return parts.join(" · ");
};

const settledWordLine = (
	word: string,
	nowMs: number,
	atMs: number,
	durationMs: number | undefined,
): string => {
	const parts = [word, formatRelative(atMs, nowMs)];
	if (durationMs !== undefined)
		parts.push(`took ${formatDuration(durationMs)}`);
	return parts.join(" · ");
};

const failedActiveWordLine = (
	nowMs: number,
	attempt: SerializedDashboardProjection["attempts"][string] | undefined,
): string => {
	const atMs = attempt?.lastEventAtMs;
	if (atMs === undefined) return "failed";
	const duration =
		attempt?.startedAtMs === undefined ? undefined : atMs - attempt.startedAtMs;
	return settledWordLine(
		"failed",
		nowMs,
		atMs,
		duration !== undefined && duration > 0 ? duration : undefined,
	);
};

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

const buildWorkDetail = (
	projection: SerializedDashboardProjection,
	work: SerializedDashboardProjection["work"][string],
	nowMs: number,
): DetailView | undefined => {
	const attempt = attemptOf(projection, work.currentRunId);
	const title = workLabel(work);
	const timeline = timelineOf(attempt);
	const attemptRunId = work.currentRunId;
	const tokens = tokenTotal(attempt?.tokens);
	const cost = attempt?.tokens?.cost;
	const ref = workRef(work.workKey);
	if (work.status === "failed") {
		return {
			kind: "failed",
			ref,
			title,
			attemptRunId,
			timeline,
			wordLine: failedActiveWordLine(nowMs, attempt),
			factsLine: factsLine({ tokens, cost, check: attempt?.check }),
			message: attempt?.lastDisplay ?? attempt?.activity ?? "Attempt failed.",
		};
	}
	if (work.status === "running" || work.status === "draining") {
		return {
			kind: "active",
			ref,
			title,
			attemptRunId,
			timeline,
			wordLine: activeWordLine(
				nowMs,
				attempt?.startedAtMs,
				attempt?.turnCount ?? 0,
			),
			factsLine: factsLine({ tokens, cost }),
			tool: attempt?.streams.tool,
			thinking: attempt?.streams.thinking,
			streaming: attempt?.streaming ?? false,
		};
	}
	const isDecision =
		work.status === "blocked" || (work.operatorActions?.length ?? 0) > 0;
	if (isDecision) {
		return {
			kind: "decision",
			ref,
			title,
			attemptRunId,
			timeline,
			wordLine: withAge("blocked", attempt?.lastEventAtMs, nowMs),
			factsLine: factsLine({ tokens, cost }),
			reason: work.blockedReason,
			decision: {
				sourceId: work.sourceId,
				workKey: work.workKey,
				actions: parseOperatorActions(work.operatorActions),
			},
		};
	}
	return undefined;
};

const buildSettledDetail = (
	projection: SerializedDashboardProjection,
	item: CompletedWorkProjection,
	nowMs: number,
): DetailView => {
	const attempt = attemptOf(projection, item.runId);
	const timeline = timelineOf(attempt);
	const failed = item.status === "failed" || item.status === "error";
	const usage = item.tokens ?? attempt?.tokens;
	const facts = factsLine({
		tokens: tokenTotal(usage),
		cost: usage?.cost,
		check: attempt?.check,
	});
	const common: DetailCommon = {
		ref: { kind: "settled", key: settledKey(item) },
		title: item.label,
		wordLine: settledWordLine(
			failed ? "failed" : "done",
			nowMs,
			item.atMs,
			item.durationMs,
		),
		factsLine: facts,
		attemptRunId: item.runId,
		timeline,
	};
	return failed
		? { ...common, kind: "failed", message: item.message }
		: { ...common, kind: "settled", message: item.message };
};

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
	if (ref.kind === "settled") {
		const item = projection.completed.find((c) => settledKey(c) === ref.key);
		return item === undefined
			? undefined
			: buildSettledDetail(projection, item, nowMs);
	}
	const work = projection.work[ref.workKey];
	if (work !== undefined) {
		const detail = buildWorkDetail(projection, work, nowMs);
		if (detail !== undefined) return detail;
	}
	const done = projection.completed.find((c) => c.workKey === ref.workKey);
	return done === undefined
		? undefined
		: buildSettledDetail(projection, done, nowMs);
};

export const refEquals = (a: DetailRef, b: DetailRef): boolean =>
	a.kind === "work" && b.kind === "work"
		? a.workKey === b.workKey
		: a.kind === "settled" && b.kind === "settled"
			? a.key === b.key
			: false;

/**
 * Openable references in river order: attention (decisions + failures) →
 * motion (active) → settled. Queued and diagnostic rows are not openable.
 */
export const openableRefs = (input: {
	readonly attention: readonly AttentionItem[];
	readonly motion: readonly MotionItem[];
	readonly settled: readonly SettledItem[];
}): readonly DetailRef[] => {
	const refs: DetailRef[] = [];
	for (const item of input.attention) {
		if (item.kind === "decision" || item.kind === "failure")
			refs.push(workRef(item.key));
	}
	for (const item of input.motion) {
		if (item.kind === "active") refs.push(workRef(item.key));
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
