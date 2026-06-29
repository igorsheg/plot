import type {
	ActivityEntry,
	AgentAttemptProjection,
	CompletedWorkProjection,
	RuntimeIdentityProjection,
	ScheduledWakeProjection,
	SerializedDashboardProjection,
	TokenSample,
	UsageTotals,
	WorkItemProjection,
} from "@plot/session/projection";
import { z } from "zod";
import { parsePlotRuns, type PlotRun } from "./run.js";

const recordSchema = z.record(z.string(), z.unknown());
const eventSchema = z
	.object({
		sequence: z.number(),
		timestamp: z.string(),
		type: z.string().optional(),
	})
	.passthrough();

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

const activityEntrySchema: z.ZodType<WebActivityEntry> = z.object({
	atMs: z.number(),
	tone: z.enum(["ok", "bad", "info"]),
	text: z.string(),
});

const activitySchema = z
	.array(z.unknown())
	.transform((entries) =>
		entries.flatMap((entry) => {
			const parsed = activityEntrySchema.safeParse(entry);
			return parsed.success ? [parsed.data] : [];
		}),
	)
	.catch([]);

const runtimeSchema: z.ZodType<RuntimeIdentityProjection> = z
	.object({
		cwd: z.string(),
		cwdName: z.string(),
		skills: z.array(z.string()).catch([]),
		skillPaths: z.array(z.string()).catch([]),
		workflowPath: z.string().optional(),
		provider: z.string().optional(),
		model: z.string().optional(),
		thinking: z.string().optional(),
		tickIntervalMs: z.number().optional(),
		maxConcurrentRuns: z.number().optional(),
		maxRunDurationMs: z.number().optional(),
	})
	.catch({ cwd: "", cwdName: "", skills: [], skillPaths: [] });

const usageTotalsSchema: z.ZodType<UsageTotals> = z
	.object({ tokens: z.number(), cost: z.number().optional() })
	.catch({ tokens: 0 });

const projectionPayloadSchema: z.ZodType<WebDashboardProjection> = z.object({
	sessionId: z.string(),
	workflowName: z.string(),
	runtime: runtimeSchema,
	status: z.enum([
		"starting",
		"idle",
		"running",
		"shutting_down",
		"paused",
		"stopped",
		"error",
	]),
	frontier: z.number(),
	usageTotals: usageTotalsSchema,
	tokenSamples: z.array(z.unknown()).catch([]) as z.ZodType<
		readonly TokenSample[]
	>,
	work: recordSchema.catch({}) as z.ZodType<Record<string, WorkItemProjection>>,
	attempts: recordSchema.catch({}) as z.ZodType<
		Record<string, AgentAttemptProjection>
	>,
	completed: z.array(z.unknown()).catch([]) as z.ZodType<
		readonly CompletedWorkProjection[]
	>,
	diagnostics: z.array(z.string()).catch([]),
	scheduledWakes: z.array(z.unknown()).catch([]) as z.ZodType<
		readonly ScheduledWakeProjection[]
	>,
	activity: activitySchema,
	debugEvents: z.array(z.string()).catch([]),
});

const projectionSchema = z
	.union([
		z.object({ projection: projectionPayloadSchema }),
		projectionPayloadSchema,
	])
	.transform((value) => ("projection" in value ? value.projection : value));

export const parsePlotEventRecord = (
	value: unknown,
): PlotEventRecord | undefined => {
	const parsed = z
		.object({ kind: z.literal("event"), event: eventSchema })
		.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

export const parseRunCatalogEvent = (
	value: unknown,
): RunCatalogEvent | undefined => {
	const parsed = z
		.object({ kind: z.literal("runs"), runs: z.array(z.unknown()) })
		.safeParse(value);
	if (!parsed.success) return undefined;
	return { kind: "runs", runs: parsePlotRuns(parsed.data.runs) };
};

const parseProjection = (
	value: unknown,
): WebDashboardProjection | undefined => {
	const parsed = projectionSchema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};

export const fetchRuns = async (): Promise<readonly PlotRun[]> => {
	const response = await fetch("/api/runs");
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parsePlotRuns(await response.json());
};

export const createRun = async (input: {
	readonly cwd?: string;
	readonly workflowPath?: string;
}): Promise<PlotRun> => {
	const response = await fetch("/api/runs", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const runs = parsePlotRuns({
		runs: [(await response.json()).run],
	});
	const run = runs[0];
	if (run === undefined) throw new Error("invalid run response");
	return run;
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
