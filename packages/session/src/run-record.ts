import { Schema } from "effect";
import {
	NonEmptyString,
	PositiveInteger,
	decodeBoundary,
	optional,
} from "./schema.js";

export const runStatusSchema = Schema.Literals([
	"starting",
	"online",
	"stopping",
	"stopped",
	"error",
]);

export const runRecordSchema = Schema.Struct({
	id: NonEmptyString,
	status: runStatusSchema,
	cwd: NonEmptyString,
	cwdName: optional(NonEmptyString),
	createdAt: NonEmptyString,
	lastSeenAt: optional(NonEmptyString),
	label: optional(NonEmptyString),
	pid: optional(PositiveInteger),
	sessionId: optional(NonEmptyString),
	workflowName: optional(NonEmptyString),
	workflowPath: optional(NonEmptyString),
	sessionDir: optional(NonEmptyString),
	lastSequence: optional(PositiveInteger),
	lastEventType: optional(NonEmptyString),
	stderrTail: optional(Schema.String),
});

const runRecordsSchema = Schema.Array(runRecordSchema);

export type RunStatus = typeof runStatusSchema.Type;
export type RunRecord = typeof runRecordSchema.Type;

export const decodeRunRecord = (value: unknown): RunRecord =>
	decodeBoundary(runRecordSchema, value);

export const decodeRunRecords = (value: unknown): readonly RunRecord[] =>
	decodeBoundary(runRecordsSchema, value);
