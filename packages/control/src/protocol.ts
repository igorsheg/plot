import { z } from "zod";
import { plotControlProtocolVersion } from "./control.js";
import {
	nonEmptyStringSchema,
	nonNegativeIntegerSchema,
	positiveIntegerSchema,
} from "./session-summary.js";

const boundedIdentifierSchema = nonEmptyStringSchema.max(128);

export const plotProtocolVersionSchema = z.literal(plotControlProtocolVersion);
export type PlotProtocolVersion = z.infer<typeof plotProtocolVersionSchema>;

export const plotProtocolRequestIdSchema = boundedIdentifierSchema;
export type PlotProtocolRequestId = z.infer<typeof plotProtocolRequestIdSchema>;
export const plotProtocolRequestId = (value: string): PlotProtocolRequestId =>
	plotProtocolRequestIdSchema.parse(value);

export const plotProtocolEpochSchema = boundedIdentifierSchema;
export type PlotProtocolEpoch = z.infer<typeof plotProtocolEpochSchema>;
export const plotProtocolEpoch = (value: string): PlotProtocolEpoch =>
	plotProtocolEpochSchema.parse(value);

export const plotProtocolSequenceSchema = nonNegativeIntegerSchema;
export type PlotProtocolSequence = z.infer<typeof plotProtocolSequenceSchema>;
export const plotProtocolSequence = (value: number): PlotProtocolSequence =>
	plotProtocolSequenceSchema.parse(value);

export const plotCommandSchema = z.enum([
	"start",
	"tick_once",
	"submit_observation",
	"get_snapshot",
	"subscribe",
	"shutdown",
	"ping",
	"auth_providers",
	"auth_status",
	"auth_login",
	"auth_logout",
]);
export type PlotCommand = z.infer<typeof plotCommandSchema>;

export const plotProtocolErrorCodeSchema = z.enum([
	"parse_error",
	"invalid_request",
	"unknown_command",
	"payload_too_large",
	"request_queue_full",
	"not_started",
	"already_started",
	"shutdown_requested",
	"session_shutdown",
	"tick_in_progress",
	"cursor_expired",
	"snapshot_unavailable",
	"auth_unavailable",
	"auth_input_required",
	"internal_error",
]);
export type PlotProtocolErrorCode = z.infer<typeof plotProtocolErrorCodeSchema>;

export const plotProtocolLimitsSchema = z
	.object({
		maxInputLineBytes: positiveIntegerSchema,
		maxOutputRecordBytes: positiveIntegerSchema,
		maxPendingRequests: positiveIntegerSchema,
		maxEventBufferEvents: positiveIntegerSchema,
		maxEventBufferBytes: positiveIntegerSchema,
		maxObservationPayloadBytes: positiveIntegerSchema,
		maxRequestIdBytes: positiveIntegerSchema,
		maxReconnectAgeMs: positiveIntegerSchema,
	})
	.strict();
export type PlotProtocolLimits = z.infer<typeof plotProtocolLimitsSchema>;

export const observationSchema = z
	.object({
		type: nonEmptyStringSchema,
		subject: nonEmptyStringSchema.optional(),
		data: z.unknown().optional(),
	})
	.strict();
export type Observation = z.infer<typeof observationSchema>;

export const subscribeParamsSchema = z
	.object({
		afterSequence: plotProtocolSequenceSchema.optional(),
	})
	.strict();
export type SubscribeParams = z.infer<typeof subscribeParamsSchema>;

export const submitObservationParamsSchema = z
	.object({
		observation: observationSchema,
	})
	.strict();
export type SubmitObservationParams = z.infer<
	typeof submitObservationParamsSchema
>;

export const authProviderParamsSchema = z
	.object({
		provider: nonEmptyStringSchema,
	})
	.strict();
export type AuthProviderParams = z.infer<typeof authProviderParamsSchema>;

export const authStatusParamsSchema = z
	.object({
		provider: nonEmptyStringSchema.optional(),
	})
	.strict();
export type AuthStatusParams = z.infer<typeof authStatusParamsSchema>;

export const authLoginParamsSchema = z
	.object({
		provider: nonEmptyStringSchema,
		promptResponses: z.array(z.string()).optional(),
		selectResponse: z.string().optional(),
		manualCode: z.string().optional(),
	})
	.strict();
export type AuthLoginParams = z.infer<typeof authLoginParamsSchema>;

export const plotClientRequestRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("request"),
		id: plotProtocolRequestIdSchema,
		command: plotCommandSchema,
		params: z.unknown().optional(),
	})
	.strict();
export type PlotClientRequestRecord = z.infer<
	typeof plotClientRequestRecordSchema
>;
export const plotClientRecordSchema = plotClientRequestRecordSchema;
export type PlotClientRecord = PlotClientRequestRecord;

export const plotHelloRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("hello"),
		sessionId: nonEmptyStringSchema,
		epoch: plotProtocolEpochSchema,
		firstEventSeq: plotProtocolSequenceSchema,
		lastEventSeq: plotProtocolSequenceSchema,
		capabilities: z.array(nonEmptyStringSchema),
		limits: plotProtocolLimitsSchema,
	})
	.strict();
export type PlotHelloRecord = z.infer<typeof plotHelloRecordSchema>;

export const plotEventRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("event"),
		sessionId: nonEmptyStringSchema,
		epoch: plotProtocolEpochSchema,
		sequence: plotProtocolSequenceSchema,
		event: z.unknown(),
	})
	.strict();
export type PlotEventRecord = z.infer<typeof plotEventRecordSchema>;

export const plotSuccessResponseRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("response"),
		id: plotProtocolRequestIdSchema,
		command: plotCommandSchema,
		ok: z.literal(true),
		lastEventSeq: plotProtocolSequenceSchema,
		data: z.unknown().optional(),
	})
	.strict();
export type PlotSuccessResponseRecord = z.infer<
	typeof plotSuccessResponseRecordSchema
>;

export const plotErrorPayloadSchema = z
	.object({
		code: plotProtocolErrorCodeSchema,
		message: z.string(),
		details: z.unknown().optional(),
	})
	.strict();
export type PlotErrorPayload = z.infer<typeof plotErrorPayloadSchema>;

export const plotErrorResponseRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("response"),
		id: plotProtocolRequestIdSchema.optional(),
		command: z.string().optional(),
		ok: z.literal(false),
		lastEventSeq: plotProtocolSequenceSchema.optional(),
		error: plotErrorPayloadSchema,
	})
	.strict();
export type PlotErrorResponseRecord = z.infer<
	typeof plotErrorResponseRecordSchema
>;

export const plotServerRecordSchema = z.union([
	plotHelloRecordSchema,
	plotEventRecordSchema,
	plotSuccessResponseRecordSchema,
	plotErrorResponseRecordSchema,
]);
export type PlotServerRecord = z.infer<typeof plotServerRecordSchema>;

export const safeParsePlotClientRecord = (value: unknown) =>
	plotClientRecordSchema.safeParse(value);
export const safeParsePlotServerRecord = (value: unknown) =>
	plotServerRecordSchema.safeParse(value);
export const safeParseSubscribeParams = (value: unknown) =>
	subscribeParamsSchema.safeParse(value ?? {});
export const safeParseSubmitObservationParams = (value: unknown) =>
	submitObservationParamsSchema.safeParse(value);
export const safeParseAuthProviderParams = (value: unknown) =>
	authProviderParamsSchema.safeParse(value);
export const safeParseAuthStatusParams = (value: unknown) =>
	authStatusParamsSchema.safeParse(value ?? {});
export const safeParseAuthLoginParams = (value: unknown) =>
	authLoginParamsSchema.safeParse(value);
