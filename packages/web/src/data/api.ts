import type {
	ActivityEntry,
	CompletedWorkProjection,
	RuntimeIdentityProjection,
	ScheduledWakeProjection,
	SerializedAgentAttemptProjection,
	SerializedDashboardProjection,
	TokenSample,
	WorkItemProjection,
} from "@plot/session/projection";
import {
	asNumber,
	asRecord,
	asString,
	asStringArray,
	type UnknownRecord,
} from "./parse.js";
import { parsePlotRuns, type PlotRun } from "./run.js";

export interface PlotEventRecord {
	readonly kind: "event";
	readonly event: UnknownRecord & {
		readonly sequence: number;
		readonly timestamp: string;
		readonly type?: string | undefined;
	};
}

export interface RunCatalogEvent {
	readonly kind: "runs";
	readonly runs: readonly PlotRun[];
}

export type WebActivityEntry = ActivityEntry;
export type WebDashboardProjection = SerializedDashboardProjection;

const projectionStatuses = new Set([
	"starting",
	"idle",
	"running",
	"shutting_down",
	"paused",
	"stopped",
	"error",
]);

const emptyRuntime: RuntimeIdentityProjection = {
	cwd: "",
	cwdName: "",
	skills: [],
	skillPaths: [],
};

const parseRuntime = (value: unknown): RuntimeIdentityProjection => {
	const record = asRecord(value);
	const cwd = asString(record?.["cwd"]);
	const cwdName = asString(record?.["cwdName"]);
	if (record === undefined || cwd === undefined || cwdName === undefined) {
		return emptyRuntime;
	}
	return {
		cwd,
		cwdName,
		skills: asStringArray(record["skills"]) ?? [],
		skillPaths: asStringArray(record["skillPaths"]) ?? [],
		workflowPath: asString(record["workflowPath"]),
		provider: asString(record["provider"]),
		model: asString(record["model"]),
		thinking: asString(record["thinking"]),
		tickIntervalMs: asNumber(record["tickIntervalMs"]),
		maxConcurrentRuns: asNumber(record["maxConcurrentRuns"]),
		maxRunDurationMs: asNumber(record["maxRunDurationMs"]),
	};
};

const parseActivity = (value: unknown): readonly WebActivityEntry[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const record = asRecord(entry);
				const atMs = asNumber(record?.["atMs"]);
				const tone = asString(record?.["tone"]);
				const text = asString(record?.["text"]);
				return record !== undefined &&
					atMs !== undefined &&
					(tone === "ok" || tone === "bad" || tone === "info") &&
					text !== undefined
					? [{ atMs, tone, text }]
					: [];
			})
		: [];

export const parsePlotEventRecord = (
	value: unknown,
): PlotEventRecord | undefined => {
	const record = asRecord(value);
	if (record?.["kind"] !== "event") return undefined;
	const event = asRecord(record["event"]);
	const sequence = asNumber(event?.["sequence"]);
	const timestamp = asString(event?.["timestamp"]);
	if (
		event === undefined ||
		sequence === undefined ||
		timestamp === undefined
	) {
		return undefined;
	}
	return {
		kind: "event",
		event: { ...event, sequence, timestamp, type: asString(event["type"]) },
	};
};

export const parseRunCatalogEvent = (
	value: unknown,
): RunCatalogEvent | undefined => {
	const record = asRecord(value);
	if (record?.["kind"] !== "runs") return undefined;
	return { kind: "runs", runs: parsePlotRuns(record["runs"]) };
};

export const parseProjection = (
	value: unknown,
): WebDashboardProjection | undefined => {
	const envelope = asRecord(value);
	const record = asRecord(envelope?.["projection"] ?? value);
	const sessionId = asString(record?.["sessionId"]);
	const workflowName = asString(record?.["workflowName"]);
	const status = asString(record?.["status"]);
	const frontier = asNumber(record?.["frontier"]);
	if (
		record === undefined ||
		sessionId === undefined ||
		workflowName === undefined ||
		status === undefined ||
		!projectionStatuses.has(status) ||
		frontier === undefined
	) {
		return undefined;
	}
	const usage = asRecord(record["usageTotals"]);
	return {
		sessionId,
		workflowName,
		status: status as WebDashboardProjection["status"],
		frontier,
		runtime: parseRuntime(record["runtime"]),
		usageTotals: {
			tokens: asNumber(usage?.["tokens"]) ?? 0,
			cost: asNumber(usage?.["cost"]),
		},
		tokenSamples: (Array.isArray(record["tokenSamples"])
			? record["tokenSamples"]
			: []) as readonly TokenSample[],
		work: (asRecord(record["work"]) ?? {}) as Record<
			string,
			WorkItemProjection
		>,
		attempts: (asRecord(record["attempts"]) ?? {}) as Record<
			string,
			SerializedAgentAttemptProjection
		>,
		completed: (Array.isArray(record["completed"])
			? record["completed"]
			: []) as readonly CompletedWorkProjection[],
		diagnostics: asStringArray(record["diagnostics"]) ?? [],
		scheduledWakes: (Array.isArray(record["scheduledWakes"])
			? record["scheduledWakes"]
			: []) as readonly ScheduledWakeProjection[],
		activity: parseActivity(record["activity"]),
		debugEvents: asStringArray(record["debugEvents"]) ?? [],
	};
};

export const fetchRuns = async (): Promise<readonly PlotRun[]> => {
	const response = await fetch("/api/runs");
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parsePlotRuns(await response.json());
};

export interface ObservationInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly comment?: string | undefined;
	readonly clientId?: string | undefined;
}

export const recordObservation = async (
	runId: string,
	input: ObservationInput,
): Promise<boolean> => {
	const response = await fetch(
		`/api/runs/${encodeURIComponent(runId)}/observations`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(input),
		},
	);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const data = (await response.json()) as { readonly accepted?: boolean };
	return data.accepted === true;
};

export const stopRun = async (id: string): Promise<void> => {
	const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
};

export const fetchRunProjectionUrl = async (
	url: string,
): Promise<WebDashboardProjection> => {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const projection = parseProjection(await response.json());
	if (projection === undefined) throw new Error("invalid projection response");
	return projection;
};

export const fetchRunProjection = async (
	key: string,
): Promise<WebDashboardProjection> =>
	fetchRunProjectionUrl(`/api/runs/${encodeURIComponent(key)}/projection`);

export const runCatalogEventsUrl = (): string => "/api/runs/events";

export const runEventsUrl = (key: string, after: number): string =>
	`/api/runs/${encodeURIComponent(key)}/events?after=${after}`;
