import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import {
	parsePlotEventRecord,
	runHistoryUrl,
	type PlotEventRecord,
	type WebDashboardProjection,
} from "./api.js";
import { applyProjectionEvent } from "./projection-live.js";

export const replayEventLimit = 20_000;
const checkpointEvery = 500;

export interface ReplayCheckpoint {
	readonly seq: number;
	readonly atMs: number;
	readonly projection: WebDashboardProjection;
}

export interface ReplayLog {
	readonly base: WebDashboardProjection;
	readonly events: readonly PlotEventRecord[];
	readonly checkpoints: readonly ReplayCheckpoint[];
	readonly truncated: boolean;
	readonly firstMs: number | undefined;
	readonly lastMs: number | undefined;
}

export interface ReplayPoint {
	readonly projection: WebDashboardProjection;
	readonly playheadMs: number;
	readonly historyTruncated: boolean;
}

const emptyReplayProjection = (
	base: WebDashboardProjection,
): WebDashboardProjection =>
	serializeDashboardProjection(
		emptyProjection(base.sessionId, base.workflowName, base.runtime),
	);

const eventMs = (record: PlotEventRecord): number => {
	const atMs = Date.parse(record.event.timestamp);
	return Number.isFinite(atMs) ? atMs : 0;
};

const bySequence = (left: PlotEventRecord, right: PlotEventRecord): number =>
	left.event.sequence - right.event.sequence;

export const buildReplayLog = (
	base: WebDashboardProjection,
	records: readonly PlotEventRecord[],
	historyTruncated = false,
): ReplayLog => {
	const capped = records.toSorted(bySequence).slice(0, replayEventLimit);
	const truncated = historyTruncated || records.length > replayEventLimit;
	let projection = emptyReplayProjection(base);
	const checkpoints: ReplayCheckpoint[] = [];
	for (const [index, record] of capped.entries()) {
		projection = applyProjectionEvent(projection, record);
		if ((index + 1) % checkpointEvery === 0) {
			checkpoints.push({
				seq: record.event.sequence,
				atMs: eventMs(record),
				projection,
			});
		}
	}
	const first = capped[0];
	const last = capped.at(-1);
	return {
		base: emptyReplayProjection(base),
		events: capped,
		checkpoints,
		truncated,
		firstMs: first === undefined ? undefined : eventMs(first),
		lastMs: last === undefined ? undefined : eventMs(last),
	};
};

export const projectionAt = (
	log: ReplayLog,
	requestedMs: number,
): ReplayPoint => {
	const coveredEndMs = log.lastMs;
	const playheadMs =
		log.truncated && coveredEndMs !== undefined && requestedMs > coveredEndMs
			? coveredEndMs
			: requestedMs;
	let projection = log.base;
	let checkpointSeq = 0;
	for (const checkpoint of log.checkpoints) {
		if (checkpoint.atMs > playheadMs) break;
		projection = checkpoint.projection;
		checkpointSeq = checkpoint.seq;
	}
	for (const record of log.events) {
		if (record.event.sequence <= checkpointSeq) continue;
		if (eventMs(record) > playheadMs) break;
		projection = applyProjectionEvent(projection, record);
	}
	return {
		projection,
		playheadMs,
		historyTruncated:
			log.truncated && coveredEndMs !== undefined && requestedMs > coveredEndMs,
	};
};

export interface ReplayHistory {
	readonly records: readonly PlotEventRecord[];
	readonly truncated: boolean;
}

const parseHistoryPage = (value: unknown): ReplayHistory => {
	if (typeof value !== "object" || value === null) {
		return { records: [], truncated: false };
	}
	const body = value as {
		readonly records?: readonly unknown[];
		readonly truncated?: unknown;
	};
	return {
		records: (body.records ?? []).flatMap((record) => {
			const parsed = parsePlotEventRecord(record);
			return parsed === undefined ? [] : [parsed];
		}),
		truncated: body.truncated === true,
	};
};

export const fetchReplayHistory = async (
	runId: string,
	options: { readonly maxEvents?: number | undefined } = {},
): Promise<ReplayHistory> => {
	const maxEvents = options.maxEvents ?? replayEventLimit;
	const records: PlotEventRecord[] = [];
	let after = 0;
	let serverTruncated = false;
	let clientCapped = false;
	while (records.length < maxEvents) {
		// eslint-disable-next-line no-await-in-loop -- pages depend on the previous frontier.
		const response = await fetch(runHistoryUrl(runId, after));
		if (!response.ok) break;
		// eslint-disable-next-line no-await-in-loop -- pages depend on the previous frontier.
		const page = parseHistoryPage(await response.json());
		const remaining = maxEvents - records.length;
		serverTruncated = page.truncated;
		if (page.records.length > remaining) {
			records.push(...page.records.slice(0, remaining));
			clientCapped = true;
			break;
		}
		records.push(...page.records);
		const last = page.records.at(-1);
		if (last !== undefined) after = last.event.sequence;
		if (!page.truncated || page.records.length === 0) break;
	}
	return { records, truncated: serverTruncated || clientCapped };
};

export const loadReplayLog = async (
	runId: string,
	base: WebDashboardProjection,
): Promise<ReplayLog> => {
	const history = await fetchReplayHistory(runId);
	return buildReplayLog(base, history.records, history.truncated);
};
