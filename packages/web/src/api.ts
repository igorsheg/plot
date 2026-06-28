import { z } from "zod";
import { parsePlotRuns, type PlotRun } from "./run.js";

const recordSchema = z.record(z.string(), z.unknown());
const eventSchema = z
	.object({
		sequence: z.number(),
		timestamp: z.string(),
		type: z.string(),
	})
	.passthrough();

export interface PlotEventRecord {
	readonly kind: "event";
	readonly event: Record<string, unknown> & {
		readonly sequence: number;
		readonly timestamp: string;
		readonly type: string;
	};
}

export interface WebActivityEntry {
	readonly atMs: number;
	readonly tone: string;
	readonly text: string;
}

export interface WebDashboardProjection {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly status: string;
	readonly frontier: number;
	readonly work: Record<string, unknown>;
	readonly attempts: Record<string, unknown>;
	readonly activity: readonly WebActivityEntry[];
}

const activityEntrySchema: z.ZodType<WebActivityEntry> = z.object({
	atMs: z.number(),
	tone: z.string(),
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

const projectionPayloadSchema: z.ZodType<WebDashboardProjection> = z.object({
	sessionId: z.string(),
	workflowName: z.string(),
	status: z.string(),
	frontier: z.number(),
	work: recordSchema.catch({}),
	attempts: recordSchema.catch({}),
	activity: activitySchema,
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

export const runEventsUrl = (key: string, after: number): string =>
	`/api/runs/${encodeURIComponent(key)}/events?after=${after}`;
