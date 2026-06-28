import { z } from "zod";
import { eventLogRecordSchema } from "./event-log.js";

const nonEmptyString = z.string().min(1);
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();

export const sessionProtocolVersion = "plot.session.v2";
export const sessionCommandSchema = z.enum([
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

export const protocolLimitsSchema = z
	.object({
		maxInputLineBytes: positiveInteger,
		maxOutputLineBytes: positiveInteger,
		maxPendingRequests: positiveInteger,
		maxBufferedEvents: positiveInteger,
	})
	.strict();

export const defaultProtocolLimits = {
	maxInputLineBytes: 1024 * 1024,
	maxOutputLineBytes: 2 * 1024 * 1024,
	maxPendingRequests: 64,
	maxBufferedEvents: 1024,
} satisfies ProtocolLimits;

export const clientRequestSchema = z
	.object({
		protocol: z.literal(sessionProtocolVersion),
		kind: z.literal("request"),
		id: nonEmptyString.max(128),
		command: sessionCommandSchema,
		params: z.unknown().optional(),
	})
	.strict();

export const welcomeRecordSchema = z
	.object({
		protocol: z.literal(sessionProtocolVersion),
		kind: z.literal("welcome"),
		sessionId: nonEmptyString,
		limits: protocolLimitsSchema,
	})
	.strict();

export const eventRecordSchema = z
	.object({
		protocol: z.literal(sessionProtocolVersion),
		kind: z.literal("event"),
		sequence: nonNegativeInteger,
		event: eventLogRecordSchema,
	})
	.strict();

export const successResponseSchema = z
	.object({
		protocol: z.literal(sessionProtocolVersion),
		kind: z.literal("response"),
		id: nonEmptyString,
		command: sessionCommandSchema,
		ok: z.literal(true),
		lastSequence: nonNegativeInteger.optional(),
		data: z.unknown().optional(),
	})
	.strict();

export const errorResponseSchema = z
	.object({
		protocol: z.literal(sessionProtocolVersion),
		kind: z.literal("response"),
		id: nonEmptyString.optional(),
		command: sessionCommandSchema.optional(),
		ok: z.literal(false),
		error: z
			.object({
				code: z.enum([
					"parse_error",
					"invalid_request",
					"payload_too_large",
					"request_queue_full",
					"session_closed",
					"internal_error",
				]),
				message: z.string(),
				details: z.unknown().optional(),
			})
			.strict(),
	})
	.strict();

export const serverRecordSchema = z.union([
	welcomeRecordSchema,
	eventRecordSchema,
	successResponseSchema,
	errorResponseSchema,
]);

export type SessionCommand = z.infer<typeof sessionCommandSchema>;
export type ProtocolLimits = z.infer<typeof protocolLimitsSchema>;
export type ClientRequest = z.infer<typeof clientRequestSchema>;
export type ServerRecord = z.infer<typeof serverRecordSchema>;
export type EventRecord = z.infer<typeof eventRecordSchema>;
export type ProtocolErrorCode =
	| "parse_error"
	| "invalid_request"
	| "payload_too_large"
	| "request_queue_full"
	| "session_closed"
	| "internal_error";

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
	welcomeRecordSchema.parse({
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
	successResponseSchema.parse({
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
	errorResponseSchema.parse({
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
