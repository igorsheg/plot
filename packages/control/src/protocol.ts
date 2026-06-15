import { z } from "zod";
import { plotControlProtocolVersion } from "./control.js";
import { operatorObservationRequestSchema } from "./operator.js";
import {
	sessionHistoryEventSchema,
	sessionHistorySequenceSchema,
} from "./session-history.js";
import {
	nonEmptyStringSchema,
	nonNegativeIntegerSchema,
	plotSessionSummarySchema,
	positiveIntegerSchema,
} from "./session-summary.js";

const boundedIdentifierSchema = nonEmptyStringSchema.max(128);

export const plotProtocolVersion = plotControlProtocolVersion;
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

export const controlConnectionRoleSchema = z.enum(["observer", "controller"]);
export type ControlConnectionRole = z.infer<typeof controlConnectionRoleSchema>;

export const plotCommandSchema = z.enum([
	"list_sessions",
	"open_session",
	"attach_session",
	"detach_session",
	"close_session",
	"pause_session",
	"resume_session",
	"request_tick",
	"interrupt_agent_run",
	"perform_operator_action",
	"get_snapshot",
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
	"session_not_found",
	"session_not_attached",
	"unauthorized",
	"session_paused",
	"session_closed",
	"run_not_found",
	"cursor_expired",
	"snapshot_unavailable",
	"invalid_operator_action",
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

export const sessionIdParamsSchema = z
	.object({ sessionId: nonEmptyStringSchema })
	.strict();
export type SessionIdParams = z.infer<typeof sessionIdParamsSchema>;

export const listSessionsParamsSchema = z.object({}).strict();
export type ListSessionsParams = z.infer<typeof listSessionsParamsSchema>;

export const openSessionParamsSchema = z
	.object({
		sessionId: nonEmptyStringSchema.optional(),
		workflowPath: nonEmptyStringSchema.optional(),
		cwd: nonEmptyStringSchema.optional(),
		role: controlConnectionRoleSchema.default("controller").optional(),
	})
	.strict();
export type OpenSessionParams = z.infer<typeof openSessionParamsSchema>;

export const attachSessionParamsSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		role: controlConnectionRoleSchema.default("observer").optional(),
		afterSequence: nonNegativeIntegerSchema.optional(),
	})
	.strict();
export type AttachSessionParams = z.infer<typeof attachSessionParamsSchema>;

export const detachSessionParamsSchema = sessionIdParamsSchema;
export type DetachSessionParams = z.infer<typeof detachSessionParamsSchema>;

export const closeSessionParamsSchema = sessionIdParamsSchema;
export type CloseSessionParams = z.infer<typeof closeSessionParamsSchema>;

export const pauseSessionParamsSchema = sessionIdParamsSchema;
export type PauseSessionParams = z.infer<typeof pauseSessionParamsSchema>;

export const resumeSessionParamsSchema = sessionIdParamsSchema;
export type ResumeSessionParams = z.infer<typeof resumeSessionParamsSchema>;

export const requestTickParamsSchema = sessionIdParamsSchema;
export type RequestTickParams = z.infer<typeof requestTickParamsSchema>;

export const interruptAgentRunParamsSchema = z
	.object({
		sessionId: nonEmptyStringSchema,
		runId: nonEmptyStringSchema,
		workKey: nonEmptyStringSchema.optional(),
	})
	.strict();
export type InterruptAgentRunParams = z.infer<
	typeof interruptAgentRunParamsSchema
>;

export const performOperatorActionParamsSchema =
	operatorObservationRequestSchema;
export type PerformOperatorActionParams = z.infer<
	typeof performOperatorActionParamsSchema
>;

export const getSnapshotParamsSchema = sessionIdParamsSchema;
export type GetSnapshotParams = z.infer<typeof getSnapshotParamsSchema>;

export const authProviderParamsSchema = z
	.object({ provider: nonEmptyStringSchema })
	.strict();
export type AuthProviderParams = z.infer<typeof authProviderParamsSchema>;

export const authStatusParamsSchema = z
	.object({ provider: nonEmptyStringSchema.optional() })
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

export const plotWelcomeRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("welcome"),
		connectionId: boundedIdentifierSchema,
		capabilities: z.array(nonEmptyStringSchema),
		limits: plotProtocolLimitsSchema,
		identity: z.unknown().optional(),
	})
	.strict();
export type PlotWelcomeRecord = z.infer<typeof plotWelcomeRecordSchema>;

export const plotSessionEventRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("session_event"),
		sessionId: nonEmptyStringSchema,
		epoch: plotProtocolEpochSchema,
		sequence: sessionHistorySequenceSchema,
		event: sessionHistoryEventSchema,
	})
	.strict();
export type PlotSessionEventRecord = z.infer<
	typeof plotSessionEventRecordSchema
>;

export const rosterEventTypeSchema = z.enum([
	"session_opened",
	"session_changed",
	"session_closed",
]);
export type RosterEventType = z.infer<typeof rosterEventTypeSchema>;

export const plotRosterEventRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("roster_event"),
		event: rosterEventTypeSchema,
		session: plotSessionSummarySchema,
	})
	.strict();
export type PlotRosterEventRecord = z.infer<typeof plotRosterEventRecordSchema>;

export const plotSuccessResponseRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("response"),
		id: plotProtocolRequestIdSchema,
		command: plotCommandSchema,
		ok: z.literal(true),
		asOfSequence: plotProtocolSequenceSchema.optional(),
		lastSequence: plotProtocolSequenceSchema.optional(),
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
		asOfSequence: plotProtocolSequenceSchema.optional(),
		lastSequence: plotProtocolSequenceSchema.optional(),
		error: plotErrorPayloadSchema,
	})
	.strict();
export type PlotErrorResponseRecord = z.infer<
	typeof plotErrorResponseRecordSchema
>;

export const plotServerRecordSchema = z.union([
	plotWelcomeRecordSchema,
	plotSessionEventRecordSchema,
	plotRosterEventRecordSchema,
	plotSuccessResponseRecordSchema,
	plotErrorResponseRecordSchema,
]);
export type PlotServerRecord = z.infer<typeof plotServerRecordSchema>;

const safeParseParams = <S extends z.ZodType>(schema: S, value: unknown) =>
	schema.safeParse(value ?? {});

export const safeParsePlotClientRecord = (value: unknown) =>
	plotClientRecordSchema.safeParse(value);
export const safeParsePlotServerRecord = (value: unknown) =>
	plotServerRecordSchema.safeParse(value);
export const safeParseListSessionsParams = (value: unknown) =>
	safeParseParams(listSessionsParamsSchema, value);
export const safeParseOpenSessionParams = (value: unknown) =>
	safeParseParams(openSessionParamsSchema, value);
export const safeParseAttachSessionParams = (value: unknown) =>
	safeParseParams(attachSessionParamsSchema, value);
export const safeParseDetachSessionParams = (value: unknown) =>
	safeParseParams(detachSessionParamsSchema, value);
export const safeParseCloseSessionParams = (value: unknown) =>
	safeParseParams(closeSessionParamsSchema, value);
export const safeParsePauseSessionParams = (value: unknown) =>
	safeParseParams(pauseSessionParamsSchema, value);
export const safeParseResumeSessionParams = (value: unknown) =>
	safeParseParams(resumeSessionParamsSchema, value);
export const safeParseRequestTickParams = (value: unknown) =>
	safeParseParams(requestTickParamsSchema, value);
export const safeParseInterruptAgentRunParams = (value: unknown) =>
	safeParseParams(interruptAgentRunParamsSchema, value);
export const safeParsePerformOperatorActionParams = (value: unknown) =>
	safeParseParams(performOperatorActionParamsSchema, value);
export const safeParseGetSnapshotParams = (value: unknown) =>
	safeParseParams(getSnapshotParamsSchema, value);
export const safeParseAuthProviderParams = (value: unknown) =>
	authProviderParamsSchema.safeParse(value);
export const safeParseAuthStatusParams = (value: unknown) =>
	safeParseParams(authStatusParamsSchema, value);
export const safeParseAuthLoginParams = (value: unknown) =>
	authLoginParamsSchema.safeParse(value);
