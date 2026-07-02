import { randomUUID } from "node:crypto";
import { Schema } from "effect";
import {
	NonEmptyString,
	PositiveInteger,
	decodeBoundary,
	optional,
} from "./schema.js";

export const sessionEventSchema = Schema.Struct({
	kind: Schema.Literal("session_event"),
	sessionId: NonEmptyString,
	sequence: PositiveInteger,
	timestamp: NonEmptyString,
	type: NonEmptyString,
	payload: optional(Schema.Unknown),
});

export const agentEventSchema = Schema.Struct({
	kind: Schema.Literal("agent_event"),
	sessionId: NonEmptyString,
	sequence: PositiveInteger,
	timestamp: NonEmptyString,
	sourceId: optional(NonEmptyString),
	runId: optional(NonEmptyString),
	workKey: optional(NonEmptyString),
	event: Schema.Unknown,
});

export const runtimeEventSchema = Schema.Union([
	sessionEventSchema,
	agentEventSchema,
]);

export type RuntimeEvent = typeof runtimeEventSchema.Type;

export interface SessionEventInput {
	readonly type: string;
	readonly payload?: unknown;
	readonly timestamp?: string;
}

export interface AgentEventInput {
	readonly sourceId?: string;
	readonly runId?: string;
	readonly workKey?: string;
	readonly event: unknown;
	readonly timestamp?: string;
}

const optionalString = (key: string, value: string | undefined) =>
	value === undefined ? {} : { [key]: value };

export const makeSessionEventRecord = (input: {
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp?: string;
	readonly event: SessionEventInput;
}): RuntimeEvent =>
	decodeBoundary(runtimeEventSchema, {
		kind: "session_event",
		sessionId: input.sessionId,
		sequence: input.sequence,
		timestamp:
			input.event.timestamp ?? input.timestamp ?? new Date().toISOString(),
		type: input.event.type,
		...(input.event.payload === undefined
			? {}
			: { payload: input.event.payload }),
	});

export const makeAgentEventRecord = (input: {
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp?: string;
	readonly event: AgentEventInput;
}): RuntimeEvent =>
	decodeBoundary(runtimeEventSchema, {
		kind: "agent_event",
		sessionId: input.sessionId,
		sequence: input.sequence,
		timestamp:
			input.event.timestamp ?? input.timestamp ?? new Date().toISOString(),
		...optionalString("sourceId", input.event.sourceId),
		...optionalString("runId", input.event.runId),
		...optionalString("workKey", input.event.workKey),
		event: input.event.event,
	});

export const createSessionId = (): string => `session-${randomUUID()}`;
