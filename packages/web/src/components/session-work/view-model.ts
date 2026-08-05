/**
 * Pure view-model for the session-work "one river" — no React. Turns a
 * projection into three salience-ordered lists: attention (decisions, failures,
 * diagnostics), motion (active, queued), and settled. The store adapter and tests
 * feed the same discriminated-union item types below, and every builder here is
 * unit-tested in isolation.
 */

import type { OperatorActionTone } from "@plot/sdk/work-contract";
import {
	workLabel,
	type CompletedWorkProjection,
	type SerializedDashboardProjection,
	type SourceActionProjection,
	type SourceReadiness,
	type WorkSubjectProjection,
} from "@plot/projection";
import { asRecord, asString } from "../../data/parse.js";

export interface OperatorActionView {
	readonly id: string;
	readonly label: string;
	readonly tone: OperatorActionTone;
	readonly disabledReason?: string | undefined;
	readonly requiresComment: boolean;
	readonly confirmTitle?: string | undefined;
}

type AttentionSourceStatus = Extract<
	SourceReadiness,
	"action-required" | "unavailable"
>;
type ActiveSourceActionStatus = Extract<
	SourceActionProjection["status"],
	"running" | "failed"
>;

export type AttentionItem =
	| {
			readonly kind: "source";
			readonly key: string;
			readonly sourceId: string;
			readonly title: string;
			readonly status: AttentionSourceStatus;
			readonly actionStatus?: ActiveSourceActionStatus | undefined;
			readonly message?: string | undefined;
			readonly progress?: string | undefined;
			readonly sinceMs?: number | undefined;
	  }
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
 * source is an LLM-authored stream (message/thinking) and markdown-safe; false
 * means render as plain text so `file_names_with_underscores` stays intact.
 */
export interface LiveLine {
	readonly text: string;
	readonly llm: boolean;
}

/** The work-state vocabulary a Subject group's children and dots speak. */
export type SubjectChildState = "active" | "queued" | "held" | "attention";

export interface SubjectCounts {
	readonly active: number;
	readonly queued: number;
	readonly held: number;
	readonly attention: number;
}

/** Dots render per child up to this bound; the rest roll into `overflow`. */
export const subjectDotLimit = 10;

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
	  }
	| {
			readonly kind: "held";
			readonly key: string;
			readonly workKey: string;
			readonly sourceId: string;
			readonly title: string;
			readonly sub?: string | undefined;
			readonly reason?: string | undefined;
			readonly actions: readonly OperatorActionView[];
	  }
	| {
			readonly kind: "subject-group";
			readonly key: string;
			readonly subjectKey: string;
			readonly title: string;
			readonly sub?: string | undefined;
			readonly progress?: WorkSubjectProjection["progress"];
			readonly counts: SubjectCounts;
			readonly live: boolean;
			readonly dots: readonly SubjectChildState[];
			readonly overflow: number;
			readonly spotlight?:
				| { readonly title: string; readonly line: LiveLine }
				| undefined;
			readonly sinceMs?: number | undefined;
	  };

export interface SettledItem extends Pick<
	CompletedWorkProjection,
	"label" | "message" | "atMs" | "durationMs"
> {
	readonly key: string;
	readonly failed: boolean;
}

type Attempt = SerializedDashboardProjection["attempts"][string];

export const attemptsByWorkKey = (
	projection: SerializedDashboardProjection,
): ReadonlyMap<string, Attempt> => {
	const attempts = new Map<string, Attempt>();
	for (const attempt of Object.values(projection.attempts))
		attempts.set(attempt.workKey, attempt);
	return attempts;
};

/**
 * `work_observed` can refresh a running row without `currentRunId` while its
 * Attempt remains active. Prefer the exact link, then recover by work identity.
 */
export const attemptFor = (
	projection: SerializedDashboardProjection,
	work: SerializedDashboardProjection["work"][string],
	byWorkKey?: ReadonlyMap<string, Attempt>,
): Attempt | undefined => {
	const linked =
		work.currentRunId === undefined
			? undefined
			: projection.attempts[work.currentRunId];
	if (linked !== undefined) return linked;
	if (byWorkKey !== undefined) return byWorkKey.get(work.workKey);
	return Object.values(projection.attempts).find(
		(attempt) => attempt.workKey === work.workKey,
	);
};

/**
 * Live line resolution, mirroring the old `attemptActivity` chain minus the
 * blocked-reason and status fallbacks (those carry their own affordances). The
 * result is tagged: only message/thinking streams are LLM-authored markdown;
 * tool commands, the last display line, the activity label, and the subtitle
 * stay plain text.
 */
export const liveLine = (
	work: SerializedDashboardProjection["work"][string],
	attempt: SerializedDashboardProjection["attempts"][string] | undefined,
): LiveLine | undefined => {
	if (attempt?.streams.tool !== undefined)
		return { text: attempt.streams.tool, llm: false };
	if (attempt?.streams.message !== undefined)
		return { text: attempt.streams.message, llm: true };
	if (attempt?.streams.thinking !== undefined)
		return { text: attempt.streams.thinking, llm: true };
	if (attempt?.lastDisplay !== undefined)
		return { text: attempt.lastDisplay, llm: false };
	if (attempt?.activity !== undefined)
		return { text: attempt.activity, llm: false };
	if (work.subtitle !== undefined) return { text: work.subtitle, llm: false };
	return undefined;
};

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
	const attempts = attemptsByWorkKey(projection);
	const sources: Extract<AttentionItem, { kind: "source" }>[] = [];
	for (const source of Object.values(projection.sources)) {
		// `checking` flashes at startup with nothing to act on; `ready` is settled.
		if (source.readiness === "ready" || source.readiness === "checking")
			continue;
		const requirement = source.requirements.find(
			(candidate) => candidate.status !== "ready",
		);
		// A cancelled action is no longer in flight; only running/failed carry state.
		const actionStatus =
			source.action?.status === "running"
				? "running"
				: source.action?.status === "failed"
					? "failed"
					: undefined;
		sources.push({
			kind: "source",
			key: `source:${source.sourceId}`,
			sourceId: source.sourceId,
			title: source.label,
			status: source.readiness,
			actionStatus,
			message: requirement?.message ?? source.message,
			progress:
				actionStatus === undefined ? undefined : source.action?.progress,
		});
	}
	const decisions: Extract<AttentionItem, { kind: "decision" }>[] = [];
	for (const work of Object.values(projection.work)) {
		const attempt = attemptFor(projection, work, attempts);
		const sinceMs = attempt?.lastEventAtMs;
		if (work.status === "blocked") {
			decisions.push({
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
	decisions.sort(byOldestSince);
	const diagnostics: AttentionItem[] = projection.diagnostics
		.slice(0, 3)
		.map((text, index) => ({
			kind: "diagnostic",
			key: `diagnostic:${index}`,
			text,
		}));
	// Source state groups above work decisions, then diagnostics last.
	return [...sources, ...decisions, ...diagnostics];
};

type WorkItem = SerializedDashboardProjection["work"][string];

export const childStateOf = (work: WorkItem): SubjectChildState =>
	work.status === "running" || work.status === "draining"
		? "active"
		: work.status === "blocked"
			? "attention"
			: work.status === "waiting"
				? "held"
				: "queued";

const subjectWorkRank = (work: WorkItem) => {
	if (work.status === "blocked") return 0;
	if (work.status === "running" || work.status === "draining") return 1;
	if (work.status === "pending") return 2;
	return 3;
};

export const subjectTitle = (subject: WorkSubjectProjection): string =>
	subject.display === undefined
		? subject.id
		: workLabel({
				primary: subject.display.primary,
				title: subject.display.title ?? subject.id,
			});

/** Children of one Subject currently in motion (blocked live in attention). */
const subjectGroup = (
	projection: SerializedDashboardProjection,
	subject: WorkSubjectProjection,
	children: readonly WorkItem[],
	attempts: ReadonlyMap<string, Attempt>,
): Extract<MotionItem, { kind: "subject-group" }> => {
	const counts: {
		active: number;
		queued: number;
		held: number;
		attention: number;
	} = {
		active: 0,
		queued: 0,
		held: 0,
		attention: 0,
	};
	const dots: SubjectChildState[] = [];
	// Attention, then live, then idle: the strip is a bounded miniature of
	// the same salience ordering used by the full Subject drawer.
	const ordered = children.toSorted(
		(a, b) =>
			subjectWorkRank(a) - subjectWorkRank(b) || a.title.localeCompare(b.title),
	);
	for (const child of ordered) {
		const state = childStateOf(child);
		counts[state] += 1;
		if (dots.length < subjectDotLimit) dots.push(state);
	}
	const liveChildren = ordered.filter(
		(child) => child.status === "running" || child.status === "draining",
	);
	// The spotlight is the most recently active live child — the one line on
	// the board that keeps a collapsed group feeling alive.
	const spotlightChild = liveChildren
		.flatMap((child) => {
			const attempt = attemptFor(projection, child, attempts);
			const line = liveLine(child, attempt);
			return line === undefined ? [] : [{ child, attempt, line }];
		})
		.toSorted(
			(a, b) =>
				(b.attempt?.lastEventAtMs ?? 0) - (a.attempt?.lastEventAtMs ?? 0),
		)[0];
	const spotlight =
		spotlightChild === undefined
			? undefined
			: {
					title: workLabel(spotlightChild.child),
					line: spotlightChild.line,
				};
	const starts = liveChildren
		.map((child) => attemptFor(projection, child, attempts)?.startedAtMs)
		.filter((value): value is number => value !== undefined);
	return {
		kind: "subject-group",
		key: `subject:${subject.subjectKey}`,
		subjectKey: subject.subjectKey,
		title: subjectTitle(subject),
		sub: subject.display?.subtitle,
		progress: subject.progress,
		counts,
		live: liveChildren.length > 0,
		dots,
		overflow: Math.max(0, children.length - dots.length),
		spotlight,
		sinceMs: starts.length === 0 ? undefined : Math.min(...starts),
	};
};

type StandaloneMotionItem = Exclude<
	MotionItem,
	{ readonly kind: "subject-group" }
>;

/** One standalone (ungrouped) Work Item as a motion row; blocked stay out. */
const motionChild = (
	projection: SerializedDashboardProjection,
	work: WorkItem,
	attempts: ReadonlyMap<string, Attempt>,
): StandaloneMotionItem | undefined => {
	if (work.status === "running" || work.status === "draining") {
		const attempt = attemptFor(projection, work, attempts);
		return {
			kind: "active",
			key: work.workKey,
			title: workLabel(work),
			sinceMs: attempt?.startedAtMs,
			line: liveLine(work, attempt),
			streaming: attempt?.streaming ?? false,
			verifying: attempt?.stage === "verifying",
		};
	}
	if (work.status === "pending")
		return {
			kind: "queued",
			key: work.workKey,
			title: workLabel(work),
			sub: work.subtitle,
			wakeDueAtMs: earliestWake(projection, work.workKey),
		};
	if (work.status === "waiting")
		return {
			kind: "held",
			key: work.workKey,
			workKey: work.workKey,
			sourceId: work.sourceId,
			title: workLabel(work),
			sub: work.subtitle,
			reason: work.blockedReason,
			actions: parseOperatorActions(work.operatorActions),
		};
	return undefined;
};

type ActiveZoneItem = Extract<MotionItem, { kind: "active" | "subject-group" }>;
type QueuedZoneItem = Extract<MotionItem, { kind: "queued" | "subject-group" }>;

export const buildMotion = (
	projection: SerializedDashboardProjection,
): readonly MotionItem[] => {
	const attempts = attemptsByWorkKey(projection);
	const activeZone: ActiveZoneItem[] = [];
	const queuedZone: QueuedZoneItem[] = [];
	const held: Extract<MotionItem, { kind: "held" }>[] = [];
	const bySubject = new Map<string, WorkItem[]>();
	for (const work of Object.values(projection.work)) {
		const subject =
			work.subjectKey === undefined
				? undefined
				: projection.subjects[work.subjectKey];
		if (subject !== undefined) {
			const children = bySubject.get(subject.subjectKey) ?? [];
			children.push(work);
			bySubject.set(subject.subjectKey, children);
			continue;
		}
		if (work.status === "blocked") continue; // attention owns decisions
		const item = motionChild(projection, work, attempts);
		if (item === undefined) continue;
		if (item.kind === "active") activeZone.push(item);
		else if (item.kind === "queued") queuedZone.push(item);
		else held.push(item);
	}
	// A Subject with a single child in motion renders as that child — a group
	// card earns its place only when it actually collapses a fan-out.
	for (const [subjectKey, children] of bySubject) {
		const subject = projection.subjects[subjectKey];
		if (subject === undefined) continue;
		const motionChildren = children.filter(
			(child) => child.status !== "blocked",
		);
		if (motionChildren.length < 2) {
			for (const work of motionChildren) {
				const item = motionChild(projection, work, attempts);
				if (item === undefined) continue;
				if (item.kind === "active") activeZone.push(item);
				else if (item.kind === "queued") queuedZone.push(item);
				else held.push(item);
			}
			continue;
		}
		const group = subjectGroup(projection, subject, children, attempts);
		if (group.live) activeZone.push(group);
		else queuedZone.push(group);
	}
	activeZone.sort(byOldestSince);
	queuedZone.sort((a, b) => a.title.localeCompare(b.title));
	held.sort((a, b) => a.title.localeCompare(b.title));
	return [...activeZone, ...queuedZone, ...held];
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
		failed: item.status !== "succeeded" && item.status !== "done",
		atMs: item.atMs,
		durationMs: item.durationMs,
	}));

/**
 * The board's four salience columns, mirroring the river's vocabulary: attention
 * (decisions, failures, diagnostics, sources), active motion, queued/held motion,
 * and settled history. Composed from the already-built river lists — the motion
 * list is split by kind (active alone, queued + held together in their existing
 * relative order); attention and settled pass through untouched.
 */
export interface BoardColumns {
	readonly attention: readonly AttentionItem[];
	readonly active: readonly Extract<
		MotionItem,
		{ kind: "active" | "subject-group" }
	>[];
	readonly queued: readonly Extract<
		MotionItem,
		{ kind: "queued" | "held" | "subject-group" }
	>[];
	readonly settled: readonly SettledItem[];
}

export const buildBoardColumns = (
	motion: readonly MotionItem[],
	attention: readonly AttentionItem[],
	settled: readonly SettledItem[],
): BoardColumns => {
	const active: BoardColumns["active"][number][] = [];
	const queued: BoardColumns["queued"][number][] = [];
	for (const item of motion) {
		if (item.kind === "active") active.push(item);
		else if (item.kind === "subject-group")
			(item.live ? active : queued).push(item);
		else queued.push(item);
	}
	return { attention, active, queued, settled };
};

export const subjectCountsText = (counts: SubjectCounts): string =>
	[
		counts.active === 0 ? undefined : `${counts.active} active`,
		counts.queued === 0 ? undefined : `${counts.queued} queued`,
		counts.held === 0 ? undefined : `${counts.held} held`,
		counts.attention === 0 ? undefined : `${counts.attention} blocked`,
	]
		.filter((part): part is string => part !== undefined)
		.join(" · ");

/** Count of decisions in the attention list — dense at 3+. */
export const decisionCount = (attention: readonly AttentionItem[]): number =>
	attention.filter((item) => item.kind === "decision").length;

/** Prefix a verifying attempt's line, without doubling an existing prefix. */
export const verifyingLine = (line: string): string =>
	line.startsWith("Verifying") ? line : `Verifying — ${line}`;
