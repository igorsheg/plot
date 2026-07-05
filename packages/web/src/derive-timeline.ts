import type { ScheduledWakeProjection } from "@plot/session/projection";
import type { WebDashboardProjection } from "./api.js";
import { formatDuration, formatTokens } from "./format.js";
import { laneOf } from "./lanes.js";

export interface TimelineSpan {
	readonly startMs: number;
	readonly endMs: number;
	readonly tone: "success" | "failed" | "running";
	readonly label: string;
}

export interface TimelineMark {
	readonly atMs: number;
	readonly kind: "wake" | "retry";
	readonly label: string;
}

export interface TimelineRow {
	readonly workKey: string;
	readonly title: string;
	readonly running: boolean;
	readonly lastActivityMs: number;
	readonly spans: readonly TimelineSpan[];
	readonly marks: readonly TimelineMark[];
}

export interface TimelineModel {
	readonly domainStartMs: number;
	readonly domainEndMs: number;
	readonly rows: readonly TimelineRow[];
	readonly sessionMarks: readonly TimelineMark[];
}

const dayMs = 24 * 60 * 60 * 1000;
const hourMs = 60 * 60 * 1000;
const missingDurationMs = 30 * 1000;

interface DraftRow {
	readonly workKey: string;
	title: string;
	readonly spans: TimelineSpan[];
	readonly marks: TimelineMark[];
}

const labelWithDuration = (
	status: "done" | "failed",
	durationMs: number,
	tokens: number | undefined,
): string =>
	[
		status,
		formatDuration(durationMs),
		tokens === undefined ? undefined : `${formatTokens(tokens)} tok`,
	]
		.filter((part) => part !== undefined)
		.join(" · ");

const wakeMark = (wake: ScheduledWakeProjection): TimelineMark => {
	const attempt = wake.attempt ?? 1;
	const reason = wake.reason ?? "tick";
	return {
		atMs: wake.dueAtMs,
		kind: attempt > 1 ? "retry" : "wake",
		label: attempt > 1 ? `retry #${attempt} — ${reason}` : reason,
	};
};

const getRow = (
	rows: Map<string, DraftRow>,
	workKey: string,
	title: string,
): DraftRow => {
	const existing = rows.get(workKey);
	if (existing !== undefined) return existing;
	const row: DraftRow = { workKey, title, spans: [], marks: [] };
	rows.set(workKey, row);
	return row;
};

const clipSpan = (
	span: TimelineSpan,
	domainStartMs: number,
	domainEndMs: number,
): TimelineSpan | undefined => {
	if (span.endMs < domainStartMs || span.startMs > domainEndMs)
		return undefined;
	return {
		...span,
		startMs: Math.max(span.startMs, domainStartMs),
		endMs: Math.min(span.endMs, domainEndMs),
	};
};

export const deriveTimeline = (
	projection: WebDashboardProjection,
	nowMs: number,
	live: boolean,
): TimelineModel => {
	const rows = new Map<string, DraftRow>();
	const sessionMarks: TimelineMark[] = [];
	let earliestSpanStartMs = Number.POSITIVE_INFINITY;
	let latestSpanEndMs = Number.NEGATIVE_INFINITY;

	for (const completed of projection.completed) {
		const durationMs = completed.durationMs ?? missingDurationMs;
		const startMs = completed.atMs - durationMs;
		const endMs = completed.atMs;
		earliestSpanStartMs = Math.min(earliestSpanStartMs, startMs);
		latestSpanEndMs = Math.max(latestSpanEndMs, endMs);
		getRow(
			rows,
			completed.workKey,
			projection.work[completed.workKey]?.title ?? completed.label,
		).spans.push({
			startMs,
			endMs,
			tone: completed.status === "done" ? "success" : "failed",
			label: labelWithDuration(
				completed.status === "done" ? "done" : "failed",
				durationMs,
				completed.tokens?.total,
			),
		});
	}

	for (const attempt of Object.values(projection.attempts)) {
		const work = projection.work[attempt.workKey];
		if (work === undefined || laneOf(work.status) !== "acting") continue;
		const startMs = attempt.startedAtMs ?? attempt.lastEventAtMs;
		if (startMs === undefined) continue;
		const rawEndMs = live ? nowMs : (attempt.lastEventAtMs ?? startMs);
		const endMs = Math.max(startMs, rawEndMs);
		earliestSpanStartMs = Math.min(earliestSpanStartMs, startMs);
		latestSpanEndMs = Math.max(latestSpanEndMs, endMs);
		getRow(rows, work.workKey, work.title).spans.push({
			startMs,
			endMs,
			tone: "running",
			label: `running · ${attempt.turnCount} turns`,
		});
	}

	let latestMarkMs = Number.NEGATIVE_INFINITY;
	for (const wake of projection.scheduledWakes) {
		const mark = wakeMark(wake);
		latestMarkMs = Math.max(latestMarkMs, mark.atMs);
		const work =
			wake.workKey === undefined ? undefined : projection.work[wake.workKey];
		if (work === undefined) {
			sessionMarks.push(mark);
		} else {
			getRow(rows, work.workKey, work.title).marks.push(mark);
		}
	}

	const latestContentMs = Math.max(latestSpanEndMs, latestMarkMs);
	const baseDomainEndMs = live
		? Math.max(
				nowMs,
				latestMarkMs === Number.NEGATIVE_INFINITY ? nowMs : latestMarkMs,
			)
		: latestContentMs === Number.NEGATIVE_INFINITY
			? nowMs
			: latestContentMs;
	const startAnchorMs = live ? nowMs : baseDomainEndMs;
	const earliest =
		earliestSpanStartMs === Number.POSITIVE_INFINITY
			? startAnchorMs - hourMs
			: Math.min(earliestSpanStartMs, startAnchorMs - hourMs);
	const domainStartMs = Math.max(startAnchorMs - dayMs, earliest);
	const domainEndMs =
		baseDomainEndMs + (baseDomainEndMs - domainStartMs) * 0.03;

	const clippedSessionMarks = sessionMarks.filter(
		(mark) => mark.atMs >= domainStartMs && mark.atMs <= domainEndMs,
	);
	const clippedRows = [...rows.values()].flatMap(
		(row): readonly TimelineRow[] => {
			const spans = row.spans.flatMap((span) => {
				const clipped = clipSpan(span, domainStartMs, domainEndMs);
				return clipped === undefined ? [] : [clipped];
			});
			const marks = row.marks.filter(
				(mark) => mark.atMs >= domainStartMs && mark.atMs <= domainEndMs,
			);
			if (spans.length === 0 && marks.length === 0) return [];
			const lastActivityMs = Math.max(
				...spans.map((span) => span.endMs),
				...marks.map((mark) => mark.atMs),
			);
			return [
				{
					workKey: row.workKey,
					title: row.title,
					running: spans.some((span) => span.tone === "running"),
					lastActivityMs,
					spans: spans.toSorted((left, right) => left.startMs - right.startMs),
					marks: marks.toSorted((left, right) => left.atMs - right.atMs),
				},
			];
		},
	);

	return {
		domainStartMs,
		domainEndMs,
		rows: clippedRows.toSorted(
			(left, right) =>
				Number(right.running) - Number(left.running) ||
				right.lastActivityMs - left.lastActivityMs ||
				left.workKey.localeCompare(right.workKey),
		),
		sessionMarks: clippedSessionMarks.toSorted(
			(left, right) => left.atMs - right.atMs,
		),
	};
};
