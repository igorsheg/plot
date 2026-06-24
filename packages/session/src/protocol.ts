import { z } from "zod";

export const plotProtocolPackageName = "@plot/session/protocol";
export const plotProtocolVersion = "plot.control.v1";
export const plotProtocolVersionSchema = z.literal(plotProtocolVersion);
export type PlotProtocolVersion = z.infer<typeof plotProtocolVersionSchema>;

export const nonEmptyStringSchema = z.string().min(1);
export const nonNegativeIntegerSchema = z.number().int().nonnegative();
export const positiveIntegerSchema = z.number().int().positive();
const boundedIdentifierSchema = nonEmptyStringSchema.max(128);

export const plotProtocolRequestIdSchema = boundedIdentifierSchema;
export type PlotProtocolRequestId = z.infer<typeof plotProtocolRequestIdSchema>;
export const plotProtocolRequestId = (value: string): PlotProtocolRequestId =>
	plotProtocolRequestIdSchema.parse(value);

export const plotProtocolSequenceSchema = nonNegativeIntegerSchema;
export type PlotProtocolSequence = z.infer<typeof plotProtocolSequenceSchema>;
export const plotProtocolSequence = (value: number): PlotProtocolSequence =>
	plotProtocolSequenceSchema.parse(value);

export const plotCommandSchema = z.enum([
	"ping",
	"get_snapshot",
	"request_tick",
]);
export type PlotCommand = z.infer<typeof plotCommandSchema>;

export const plotProtocolErrorCodeSchema = z.enum([
	"parse_error",
	"invalid_request",
	"unknown_command",
	"payload_too_large",
	"request_queue_full",
	"session_closed",
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
export const defaultPlotProtocolLimits: PlotProtocolLimits = {
	maxInputLineBytes: 1024 * 1024,
	maxOutputRecordBytes: 2 * 1024 * 1024,
	maxPendingRequests: 64,
	maxEventBufferEvents: 1024,
	maxEventBufferBytes: 16 * 1024 * 1024,
	maxObservationPayloadBytes: 512 * 1024,
	maxRequestIdBytes: 128,
	maxReconnectAgeMs: 5 * 60 * 1000,
};

export const eventLogSequenceSchema = positiveIntegerSchema;
export type EventLogSequence = z.infer<typeof eventLogSequenceSchema>;

export const plotEventSchema = z.union([
	z
		.object({
			sessionId: nonEmptyStringSchema,
			epoch: nonEmptyStringSchema.optional(),
			sequence: eventLogSequenceSchema,
			timestamp: nonEmptyStringSchema,
			type: nonEmptyStringSchema,
			payload: z.unknown(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("agent_session_event"),
			sessionId: nonEmptyStringSchema,
			sequence: eventLogSequenceSchema,
			timestamp: nonEmptyStringSchema,
			epoch: nonEmptyStringSchema.optional(),
			type: nonEmptyStringSchema,
			payload: z.unknown().optional(),
			sourceId: nonEmptyStringSchema.optional(),
			runId: nonEmptyStringSchema.optional(),
			workKey: nonEmptyStringSchema.optional(),
			event: z.unknown(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("plot_event"),
			sessionId: nonEmptyStringSchema,
			sequence: eventLogSequenceSchema,
			timestamp: nonEmptyStringSchema,
			epoch: nonEmptyStringSchema.optional(),
			type: nonEmptyStringSchema,
			payload: z.unknown(),
		})
		.strict(),
]);
export type PlotEvent = z.infer<typeof plotEventSchema>;
export type EventLogEvent = PlotEvent;

export const eventLogEventSchema = plotEventSchema;
export const safeParseEventLogEvent = (value: unknown) =>
	eventLogEventSchema.safeParse(value);

export const getSnapshotParamsSchema = z.object({}).strict();
export type GetSnapshotParams = z.infer<typeof getSnapshotParamsSchema>;
export const requestTickParamsSchema = z.object({}).strict();
export type RequestTickParams = z.infer<typeof requestTickParamsSchema>;

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
		sessionId: nonEmptyStringSchema,
		limits: plotProtocolLimitsSchema,
	})
	.strict();
export type PlotWelcomeRecord = z.infer<typeof plotWelcomeRecordSchema>;

export const plotEventRecordSchema = z
	.object({
		protocol: plotProtocolVersionSchema,
		kind: z.literal("event"),
		sessionId: nonEmptyStringSchema.optional(),
		epoch: nonEmptyStringSchema.optional(),
		sequence: eventLogSequenceSchema.optional(),
		event: plotEventSchema,
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
		lastSequence: plotProtocolSequenceSchema.optional(),
		error: plotErrorPayloadSchema,
	})
	.strict();
export type PlotErrorResponseRecord = z.infer<
	typeof plotErrorResponseRecordSchema
>;

export const plotServerRecordSchema = z.union([
	plotWelcomeRecordSchema,
	plotEventRecordSchema,
	plotSuccessResponseRecordSchema,
	plotErrorResponseRecordSchema,
]);
export type PlotServerRecord = z.infer<typeof plotServerRecordSchema>;

export interface ProtocolParseIssue {
	readonly path: readonly PropertyKey[];
	readonly message: string;
}
export const formatProtocolParseIssues = (
	issues: readonly ProtocolParseIssue[],
): string =>
	issues
		.map(
			(issue) =>
				`${issue.path.length === 0 ? "record" : issue.path.map(String).join(".")}: ${issue.message}`,
		)
		.join("; ");

export class PlotProtocolFailure extends Error {
	readonly code: PlotProtocolErrorCode;
	readonly details?: unknown;
	constructor(input: {
		readonly code: PlotProtocolErrorCode;
		readonly message: string;
		readonly details?: unknown;
	}) {
		super(input.message);
		this.name = "PlotProtocolFailure";
		this.code = input.code;
		if (input.details !== undefined) this.details = input.details;
	}
}
const invalidRecord = (issues: readonly ProtocolParseIssue[]) =>
	new PlotProtocolFailure({
		code: "invalid_request",
		message: formatProtocolParseIssues(issues),
	});

export const safeParsePlotClientRecord = (value: unknown) =>
	plotClientRecordSchema.safeParse(value);
export const safeParsePlotServerRecord = (value: unknown) =>
	plotServerRecordSchema.safeParse(value);
export const decodePlotClientRecord = (value: unknown): PlotClientRecord => {
	const parsed = safeParsePlotClientRecord(value);
	if (!parsed.success) throw invalidRecord(parsed.error.issues);
	return parsed.data;
};
export const decodePlotServerRecord = (value: unknown): PlotServerRecord => {
	const parsed = safeParsePlotServerRecord(value);
	if (!parsed.success) throw invalidRecord(parsed.error.issues);
	return parsed.data;
};

export const makePlotWelcomeRecord = (options: {
	readonly sessionId: string;
	readonly limits: PlotProtocolLimits;
}): PlotWelcomeRecord => ({
	protocol: plotProtocolVersion,
	kind: "welcome",
	sessionId: options.sessionId,
	limits: options.limits,
});
export const makePlotEventRecord = (event: PlotEvent): PlotEventRecord => ({
	protocol: plotProtocolVersion,
	kind: "event",
	event,
});
export const makePlotSuccessResponse = (options: {
	readonly id: PlotProtocolRequestId;
	readonly command: PlotCommand;
	readonly lastSequence?: PlotProtocolSequence;
	readonly data?: unknown;
}): PlotSuccessResponseRecord => ({
	protocol: plotProtocolVersion,
	kind: "response",
	id: options.id,
	command: options.command,
	ok: true,
	...(options.lastSequence === undefined
		? {}
		: { lastSequence: options.lastSequence }),
	...(options.data === undefined ? {} : { data: options.data }),
});
export const makePlotErrorResponse = (options: {
	readonly code: PlotProtocolErrorCode;
	readonly message: string;
	readonly id?: PlotProtocolRequestId;
	readonly command?: string;
	readonly lastSequence?: PlotProtocolSequence;
	readonly details?: unknown;
}): PlotErrorResponseRecord => ({
	protocol: plotProtocolVersion,
	kind: "response",
	...(options.id === undefined ? {} : { id: options.id }),
	...(options.command === undefined ? {} : { command: options.command }),
	ok: false,
	...(options.lastSequence === undefined
		? {}
		: { lastSequence: options.lastSequence }),
	error: {
		code: options.code,
		message: options.message,
		...(options.details === undefined ? {} : { details: options.details }),
	},
});

const safeParseParams = <S extends z.ZodType>(schema: S, value: unknown) =>
	schema.safeParse(value ?? {});
export const safeParseGetSnapshotParams = (value: unknown) =>
	safeParseParams(getSnapshotParamsSchema, value);
export const safeParseRequestTickParams = (value: unknown) =>
	safeParseParams(requestTickParamsSchema, value);
