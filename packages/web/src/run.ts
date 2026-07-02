import { Schema } from "effect";
import { decodeOrUndefined, optional } from "./schema.js";

export interface PlotRun {
	readonly id: string;
	readonly status: string;
	readonly cwd: string;
	readonly createdAt: string;
	readonly lastSeenAt?: string | undefined;
	readonly label?: string | undefined;
	readonly sessionId?: string | undefined;
	readonly workflowName?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly cwdName?: string | undefined;
	readonly sessionDir?: string | undefined;
	readonly lastSequence?: number | undefined;
	readonly lastEventType?: string | undefined;
	readonly pid?: number | undefined;
	readonly stderrTail?: string | undefined;
}

const plotRunSchema = Schema.Struct({
	id: Schema.String,
	status: Schema.String,
	cwd: Schema.String,
	createdAt: Schema.String,
	lastSeenAt: optional(Schema.String),
	label: optional(Schema.String),
	sessionId: optional(Schema.String),
	workflowName: optional(Schema.String),
	workflowPath: optional(Schema.String),
	cwdName: optional(Schema.String),
	sessionDir: optional(Schema.String),
	lastSequence: optional(Schema.Number),
	lastEventType: optional(Schema.String),
	pid: optional(Schema.Number),
	stderrTail: optional(Schema.String),
});

const runListObjectSchema = Schema.Struct({
	runs: Schema.Array(Schema.Unknown),
});

// Registry records grow fields over time; a stale watcher must not go blind.
const parseRun = (value: unknown): PlotRun | undefined =>
	decodeOrUndefined(plotRunSchema, value);

export const parsePlotRuns = (value: unknown): readonly PlotRun[] => {
	const rows = Array.isArray(value)
		? value
		: decodeOrUndefined(runListObjectSchema, value)?.runs;
	return (rows ?? []).map(parseRun).filter((entry) => entry !== undefined);
};
