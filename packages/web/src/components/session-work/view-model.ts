/**
 * Pure view-model for the session-work "one river" — no React. Turns a
 * projection into three salience-ordered lists: attention (decisions, failures,
 * diagnostics), motion (active, queued), and settled. The store adapter and the
 * /lab fixtures both feed the same discriminated-union item types below, and
 * every builder here is unit-tested in isolation.
 */

import {
	workLabel,
	type SerializedDashboardProjection,
} from "@plot/projection";
import { asRecord, asString } from "../../data/parse.js";

export interface OperatorActionView {
	readonly id: string;
	readonly label: string;
	readonly tone: "primary" | "secondary" | "danger";
	readonly disabledReason?: string | undefined;
	readonly requiresComment: boolean;
	readonly confirmTitle?: string | undefined;
}

export type AttentionItem =
	| {
			readonly kind: "decision";
			readonly key: string;
			readonly workKey: string;
			readonly sourceId: string;
			readonly title: string;
			readonly sinceMs?: number | undefined;
			readonly reason?: string | undefined;
			readonly actions: readonly OperatorActionView[];
	  }
	| {
			readonly kind: "failure";
			readonly key: string;
			readonly title: string;
			readonly sinceMs?: number | undefined;
			readonly line?: string | undefined;
	  }
	| {
			readonly kind: "diagnostic";
			readonly key: string;
			readonly text: string;
	  };

/**
 * A resolved live line tagged by origin: `llm` is true only when the winning
 * source is an LLM-authored stream (message/thinking) — markdown-safe — and
 * false for tool commands and status subtitles, which stay plain mono so a
 * markdown renderer can't mangle `file_names_with_underscores`.
 */
export interface LiveLine {
	readonly text: string;
	readonly llm: boolean;
}

export type MotionItem =
	| {
			readonly kind: "active";
			readonly key: string;
			readonly title: string;
			readonly sinceMs?: number | undefined;
			readonly line?: LiveLine | undefined;
			readonly streaming: boolean;
			readonly verifying: boolean;
	  }
	| {
			readonly kind: "queued";
			readonly key: string;
			readonly title: string;
			readonly sub?: string | undefined;
			readonly wakeDueAtMs?: number | undefined;
	  };

export interface SettledItem {
	readonly key: string;
	readonly label: string;
	readonly message: string;
	readonly failed: boolean;
	readonly atMs: number;
	readonly durationMs?: number | undefined;
}

const attemptFor = (
	projection: SerializedDashboardProjection,
	work: SerializedDashboardProjection["work"][string],
): SerializedDashboardProjection["attempts"][string] | undefined =>
	work.currentRunId === undefined
		? undefined
		: projection.attempts[work.currentRunId];

/**
 * Live line resolution, mirroring the old `attemptActivity` chain minus the
 * blocked-reason and status fallbacks (those carry their own affordances). The
 * result is tagged: only message/thinking streams are LLM-authored markdown;
 * tool commands, the activity label, and the subtitle stay plain mono.
 */
const liveLine = (
	work: SerializedDashboardProjection["work"][string],
	attempt: SerializedDashboardProjection["attempts"][string] | undefined,
): LiveLine | undefined => {
	if (attempt?.streams.tool !== undefined)
		return { text: attempt.streams.tool, llm: false };
	if (attempt?.streams.message !== undefined)
		return { text: attempt.streams.message, llm: true };
	if (attempt?.streams.thinking !== undefined)
		return { text: attempt.streams.thinking, llm: true };
	if (attempt?.activity !== undefined)
		return { text: attempt.activity, llm: false };
	if (work.subtitle !== undefined) return { text: work.subtitle, llm: false };
	return undefined;
};

const hasActions = (
	work: SerializedDashboardProjection["work"][string],
): boolean => (work.operatorActions?.length ?? 0) > 0;

/** `sinceMs` unknown sorts last; otherwise oldest event first. */
const byOldestSince = (
	a: { readonly sinceMs?: number | undefined },
	b: { readonly sinceMs?: number | undefined },
): number => (a.sinceMs ?? Infinity) - (b.sinceMs ?? Infinity);

export const parseOperatorActions = (
	value: readonly unknown[] | undefined,
): readonly OperatorActionView[] => {
	if (value === undefined) return [];
	const parsed: OperatorActionView[] = [];
	for (const entry of value) {
		const record = asRecord(entry);
		const id = asString(record?.["id"]);
		const label = asString(record?.["label"]);
		if (record === undefined || id === undefined || label === undefined) {
			continue;
		}
		const toneRaw = asString(record["tone"]);
		const tone =
			toneRaw === "secondary" || toneRaw === "danger" ? toneRaw : "primary";
		const confirm = asRecord(record["confirm"]);
		parsed.push({
			id,
			label,
			tone,
			disabledReason: asString(record["disabledReason"]),
			requiresComment: record["requiresComment"] === true,
			confirmTitle: asString(confirm?.["title"]),
		});
	}
	return parsed;
};

export const buildAttention = (
	projection: SerializedDashboardProjection,
): readonly AttentionItem[] => {
	const pending: Exclude<AttentionItem, { kind: "diagnostic" }>[] = [];
	for (const work of Object.values(projection.work)) {
		const attempt = attemptFor(projection, work);
		const sinceMs = attempt?.lastEventAtMs;
		if (work.status === "failed") {
			pending.push({
				kind: "failure",
				key: work.workKey,
				title: workLabel(work),
				sinceMs,
				line: attempt?.lastDisplay ?? attempt?.activity,
			});
		} else if (work.status === "blocked" || hasActions(work)) {
			pending.push({
				kind: "decision",
				key: work.workKey,
				workKey: work.workKey,
				sourceId: work.sourceId,
				title: workLabel(work),
				sinceMs,
				reason: work.blockedReason,
				actions: parseOperatorActions(work.operatorActions),
			});
		}
	}
	pending.sort(byOldestSince);
	const diagnostics: AttentionItem[] = projection.diagnostics
		.slice(0, 3)
		.map((text, index) => ({
			kind: "diagnostic",
			key: `diagnostic:${index}`,
			text,
		}));
	return [...pending, ...diagnostics];
};

export const buildMotion = (
	projection: SerializedDashboardProjection,
): readonly MotionItem[] => {
	const active: Extract<MotionItem, { kind: "active" }>[] = [];
	const queued: Extract<MotionItem, { kind: "queued" }>[] = [];
	for (const work of Object.values(projection.work)) {
		if (work.status === "running" || work.status === "draining") {
			const attempt = attemptFor(projection, work);
			active.push({
				kind: "active",
				key: work.workKey,
				title: workLabel(work),
				sinceMs: attempt?.startedAtMs,
				line: liveLine(work, attempt),
				streaming: attempt?.streaming ?? false,
				verifying: attempt?.stage === "verifying",
			});
		} else if (work.status === "waiting" || work.status === "pending") {
			queued.push({
				kind: "queued",
				key: work.workKey,
				title: workLabel(work),
				sub: work.subtitle,
				wakeDueAtMs: earliestWake(projection, work.workKey),
			});
		}
	}
	active.sort(byOldestSince);
	queued.sort((a, b) => a.title.localeCompare(b.title));
	return [...active, ...queued];
};

const earliestWake = (
	projection: SerializedDashboardProjection,
	workKey: string,
): number | undefined => {
	let due: number | undefined;
	for (const wake of projection.scheduledWakes) {
		if (wake.workKey !== workKey) continue;
		if (due === undefined || wake.dueAtMs < due) due = wake.dueAtMs;
	}
	return due;
};

export const buildSettled = (
	projection: SerializedDashboardProjection,
): readonly SettledItem[] =>
	projection.completed.slice(0, 7).map((item) => ({
		key: `${item.workKey}:${item.runId ?? "run"}:${item.atMs}`,
		label: item.label,
		message: item.message,
		failed: item.status === "failed" || item.status === "error",
		atMs: item.atMs,
		durationMs: item.durationMs,
	}));

/** Count of decisions in the attention list — dense at 3+. */
export const decisionCount = (attention: readonly AttentionItem[]): number =>
	attention.filter((item) => item.kind === "decision").length;

/** Prefix a verifying attempt's line, without doubling an existing prefix. */
export const verifyingLine = (line: string): string =>
	line.startsWith("Verifying") ? line : `Verifying — ${line}`;
