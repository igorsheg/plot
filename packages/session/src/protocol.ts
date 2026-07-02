import { Schema } from "effect";
import { runtimeEventSchema, type RuntimeEvent } from "./runtime-event.js";
import {
	NonEmptyString,
	NonNegativeInteger,
	PositiveInteger,
	decodeBoundary,
	optional,
} from "./schema.js";

export const sessionProtocolVersion = "plot.session.v2";
export const sessionCommandSchema = Schema.Literals([
	"ping",
	"start",
	"shutdown",
	"get_state",
	"get_snapshot",
	"request_tick",
	"pause_dispatch",
	"resume_dispatch",
	"interrupt_agent_run",
]);

export const protocolLimitsSchema = Schema.Struct({
	maxInputLineBytes: PositiveInteger,
	maxOutputLineBytes: PositiveInteger,
	maxPendingRequests: PositiveInteger,
	maxBufferedEvents: PositiveInteger,
});

export type SessionCommand = typeof sessionCommandSchema.Type;
export type ProtocolLimits = typeof protocolLimitsSchema.Type;

export const defaultProtocolLimits = {
	maxInputLineBytes: 1024 * 1024,
	maxOutputLineBytes: 2 * 1024 * 1024,
	maxPendingRequests: 64,
	maxBufferedEvents: 1024,
} satisfies ProtocolLimits;

export const clientRequestSchema = Schema.Struct({
	protocol: Schema.Literal(sessionProtocolVersion),
	kind: Schema.Literal("request"),
	id: NonEmptyString.check(Schema.isMaxLength(128)),
	command: sessionCommandSchema,
	params: optional(Schema.Unknown),
});

export const welcomeRecordSchema = Schema.Struct({
	protocol: Schema.Literal(sessionProtocolVersion),
	kind: Schema.Literal("welcome"),
	sessionId: NonEmptyString,
	limits: protocolLimitsSchema,
});

export const eventRecordSchema = Schema.Struct({
	protocol: Schema.Literal(sessionProtocolVersion),
	kind: Schema.Literal("event"),
	sequence: NonNegativeInteger,
	event: runtimeEventSchema,
});

export const successResponseSchema = Schema.Struct({
	protocol: Schema.Literal(sessionProtocolVersion),
	kind: Schema.Literal("response"),
	id: NonEmptyString,
	command: sessionCommandSchema,
	ok: Schema.Literal(true),
	lastSequence: optional(NonNegativeInteger),
	data: optional(Schema.Unknown),
});

export const protocolErrorCodeSchema = Schema.Literals([
	"parse_error",
	"invalid_request",
	"payload_too_large",
	"request_queue_full",
	"session_closed",
	"internal_error",
]);

export const errorResponseSchema = Schema.Struct({
	protocol: Schema.Literal(sessionProtocolVersion),
	kind: Schema.Literal("response"),
	id: optional(NonEmptyString),
	command: optional(sessionCommandSchema),
	ok: Schema.Literal(false),
	error: Schema.Struct({
		code: protocolErrorCodeSchema,
		message: Schema.String,
		details: optional(Schema.Unknown),
	}),
});

export const serverRecordSchema = Schema.Union([
	welcomeRecordSchema,
	eventRecordSchema,
	successResponseSchema,
	errorResponseSchema,
]);

export type ClientRequest = typeof clientRequestSchema.Type;
export type WelcomeRecord = typeof welcomeRecordSchema.Type;
export type EventRecord = Omit<typeof eventRecordSchema.Type, "event"> & {
	readonly event: RuntimeEvent;
};
export type SuccessResponse = typeof successResponseSchema.Type;
export type ErrorResponse = typeof errorResponseSchema.Type;
export type ServerRecord =
	| WelcomeRecord
	| EventRecord
	| SuccessResponse
	| ErrorResponse;
export type ProtocolErrorCode = typeof protocolErrorCodeSchema.Type;

export const decodeClientRequest = (value: unknown): ClientRequest =>
	decodeBoundary(clientRequestSchema, value);
export const decodeServerRecord = (value: unknown): ServerRecord =>
	decodeBoundary(serverRecordSchema, value) as ServerRecord;

export class ProtocolBoundaryError extends Error {
	override readonly name = "ProtocolBoundaryError";
	readonly code: ProtocolErrorCode;
	readonly details?: unknown;

	constructor(input: {
		readonly code: ProtocolErrorCode;
		readonly message: string;
		readonly details?: unknown;
	}) {
		super(input.message);
		this.code = input.code;
		if (input.details !== undefined) this.details = input.details;
	}
}

export const makeWelcome = (input: {
	readonly sessionId: string;
	readonly limits: ProtocolLimits;
}): ServerRecord =>
	decodeBoundary(welcomeRecordSchema, {
		protocol: sessionProtocolVersion,
		kind: "welcome",
		sessionId: input.sessionId,
		limits: input.limits,
	});

export const makeSuccess = (input: {
	readonly request: ClientRequest;
	readonly lastSequence?: number;
	readonly data?: unknown;
}): ServerRecord =>
	decodeBoundary(successResponseSchema, {
		protocol: sessionProtocolVersion,
		kind: "response",
		id: input.request.id,
		command: input.request.command,
		ok: true,
		...(input.lastSequence === undefined
			? {}
			: { lastSequence: input.lastSequence }),
		...(input.data === undefined ? {} : { data: input.data }),
	});

export const makeError = (input: {
	readonly request?: ClientRequest;
	readonly code: ProtocolErrorCode;
	readonly message: string;
	readonly details?: unknown;
}): ServerRecord =>
	decodeBoundary(errorResponseSchema, {
		protocol: sessionProtocolVersion,
		kind: "response",
		...(input.request === undefined
			? {}
			: { id: input.request.id, command: input.request.command }),
		ok: false,
		error: {
			code: input.code,
			message: input.message,
			...(input.details === undefined ? {} : { details: input.details }),
		},
	});
