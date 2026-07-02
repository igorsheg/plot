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
import { Schema } from "effect";
import { decodeOrUndefined, optional } from "./schema.js";
import { parsePlotRuns, type PlotRun } from "./run.js";

const recordSchema = Schema.Record(Schema.String, Schema.Unknown);
const eventSchema = Schema.Struct({
	sequence: Schema.Number,
	timestamp: Schema.String,
	type: optional(Schema.String),
});

export interface PlotEventRecord {
	readonly kind: "event";
	readonly event: Record<string, unknown> & {
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

const activityEntrySchema = Schema.Struct({
	atMs: Schema.Number,
	tone: Schema.Literals(["ok", "bad", "info"]),
	text: Schema.String,
});

const runtimeSchema = Schema.Struct({
	cwd: Schema.String,
	cwdName: Schema.String,
	skills: optional(Schema.Array(Schema.String)),
	skillPaths: optional(Schema.Array(Schema.String)),
	workflowPath: optional(Schema.String),
	provider: optional(Schema.String),
	model: optional(Schema.String),
	thinking: optional(Schema.String),
	tickIntervalMs: optional(Schema.Number),
	maxConcurrentRuns: optional(Schema.Number),
	maxRunDurationMs: optional(Schema.Number),
});

const usageTotalsSchema = Schema.Struct({
	tokens: Schema.Number,
	cost: optional(Schema.Number),
});

const projectionRequiredSchema = Schema.Struct({
	sessionId: Schema.String,
	workflowName: Schema.String,
	status: Schema.Literals([
		"starting",
		"idle",
		"running",
		"shutting_down",
		"paused",
		"stopped",
		"error",
	]),
	frontier: Schema.Number,
});

const emptyRuntime: RuntimeIdentityProjection = {
	cwd: "",
	cwdName: "",
	skills: [],
	skillPaths: [],
};

const parseRuntime = (value: unknown): RuntimeIdentityProjection => {
	const runtime = decodeOrUndefined(runtimeSchema, value);
	return runtime === undefined
		? emptyRuntime
		: {
				...runtime,
				skills: runtime.skills ?? [],
				skillPaths: runtime.skillPaths ?? [],
			};
};

const parseActivity = (value: unknown): readonly WebActivityEntry[] => {
	const entries = decodeOrUndefined(Schema.Array(Schema.Unknown), value) ?? [];
	return entries.flatMap((entry) => {
		const parsed = decodeOrUndefined(activityEntrySchema, entry);
		return parsed === undefined ? [] : [parsed];
	});
};

export const parsePlotEventRecord = (
	value: unknown,
): PlotEventRecord | undefined => {
	const parsed = decodeOrUndefined(
		Schema.Struct({ kind: Schema.Literal("event"), event: eventSchema }),
		value,
		"preserve",
	);
	return parsed === undefined
		? undefined
		: (parsed as unknown as PlotEventRecord);
};

export const parseRunCatalogEvent = (
	value: unknown,
): RunCatalogEvent | undefined => {
	const parsed = decodeOrUndefined(
		Schema.Struct({
			kind: Schema.Literal("runs"),
			runs: Schema.Array(Schema.Unknown),
		}),
		value,
	);
	if (parsed === undefined) return undefined;
	return { kind: "runs", runs: parsePlotRuns(parsed.runs) };
};

const parseProjection = (
	value: unknown,
): WebDashboardProjection | undefined => {
	const envelope = decodeOrUndefined(recordSchema, value);
	const raw = envelope?.["projection"] ?? value;
	const record = decodeOrUndefined(recordSchema, raw);
	if (record === undefined) return undefined;
	const required = decodeOrUndefined(projectionRequiredSchema, record);
	if (required === undefined) return undefined;
	return {
		...required,
		runtime: parseRuntime(record["runtime"]),
		usageTotals: decodeOrUndefined(
			usageTotalsSchema,
			record["usageTotals"],
		) ?? {
			tokens: 0,
		},
		tokenSamples: (decodeOrUndefined(
			Schema.Array(Schema.Unknown),
			record["tokenSamples"],
		) ?? []) as readonly TokenSample[],
		work: (decodeOrUndefined(recordSchema, record["work"]) ?? {}) as Record<
			string,
			WorkItemProjection
		>,
		attempts: (decodeOrUndefined(recordSchema, record["attempts"]) ??
			{}) as Record<string, SerializedAgentAttemptProjection>,
		completed: (decodeOrUndefined(
			Schema.Array(Schema.Unknown),
			record["completed"],
		) ?? []) as readonly CompletedWorkProjection[],
		diagnostics:
			decodeOrUndefined(Schema.Array(Schema.String), record["diagnostics"]) ??
			[],
		scheduledWakes: (decodeOrUndefined(
			Schema.Array(Schema.Unknown),
			record["scheduledWakes"],
		) ?? []) as readonly ScheduledWakeProjection[],
		activity: parseActivity(record["activity"]),
		debugEvents:
			decodeOrUndefined(Schema.Array(Schema.String), record["debugEvents"]) ??
			[],
	};
};

export const fetchRuns = async (): Promise<readonly PlotRun[]> => {
	const response = await fetch("/api/runs");
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parsePlotRuns(await response.json());
};

export const stopRun = async (id: string): Promise<void> => {
	const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
};

export const fetchRunProjection = async (
	key: string,
): Promise<WebDashboardProjection> => {
	const response = await fetch(
		`/api/runs/${encodeURIComponent(key)}/projection`,
	);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const projection = parseProjection(await response.json());
	if (projection === undefined) throw new Error("invalid projection response");
	return projection;
};

export const runCatalogEventsUrl = (): string => "/api/runs/events";

export const runEventsUrl = (key: string, after: number): string =>
	`/api/runs/${encodeURIComponent(key)}/events?after=${after}`;
