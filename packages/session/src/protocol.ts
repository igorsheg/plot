import { Effect, Schema } from "effect";
import * as Domain from "@plot/agent/model";
import {
	PlotSessionEventSequence,
	PlotSessionId,
	type PlotSessionEvent as PlotSessionEventType,
} from "./plot-session.js";

export const PlotProtocolVersion = Schema.Literal("plot.v1");
export type PlotProtocolVersion = typeof PlotProtocolVersion.Type;

export const PlotProtocolRequestId = Schema.NonEmptyString.pipe(
	Schema.check(Schema.isMaxLength(128)),
	Schema.brand("PlotProtocolRequestId"),
);
export type PlotProtocolRequestId = typeof PlotProtocolRequestId.Type;
export const plotProtocolRequestId = (value: string): PlotProtocolRequestId =>
	Schema.decodeUnknownSync(PlotProtocolRequestId)(value);

export const PlotProtocolEpoch = Schema.NonEmptyString.pipe(
	Schema.check(Schema.isMaxLength(128)),
	Schema.brand("PlotProtocolEpoch"),
);
export type PlotProtocolEpoch = typeof PlotProtocolEpoch.Type;
export const plotProtocolEpoch = (value: string): PlotProtocolEpoch =>
	Schema.decodeUnknownSync(PlotProtocolEpoch)(value);

export const PlotProtocolSequence = Schema.Number.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
	Schema.brand("PlotProtocolSequence"),
);
export type PlotProtocolSequence = typeof PlotProtocolSequence.Type;
export const plotProtocolSequence = (value: number): PlotProtocolSequence =>
	Schema.decodeUnknownSync(PlotProtocolSequence)(value);

export const PlotCommand = Schema.Literals([
	"start",
	"tick_once",
	"submit_observation",
	"get_snapshot",
	"subscribe",
	"shutdown",
	"ping",
]);
export type PlotCommand = typeof PlotCommand.Type;

export const PlotProtocolErrorCode = Schema.Literals([
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
	"internal_error",
]);
export type PlotProtocolErrorCode = typeof PlotProtocolErrorCode.Type;

export class PlotProtocolFailure extends Schema.TaggedErrorClass<PlotProtocolFailure>()(
	"PlotProtocolFailure",
	{
		code: PlotProtocolErrorCode,
		message: Schema.String,
		details: Schema.optionalKey(Schema.Unknown),
	},
) {}

export class PlotProtocolLimits extends Schema.Class<PlotProtocolLimits>(
	"PlotProtocolLimits",
)({
	maxInputLineBytes: Domain.PositiveInt,
	maxOutputRecordBytes: Domain.PositiveInt,
	maxPendingRequests: Domain.PositiveInt,
	maxEventBufferEvents: Domain.PositiveInt,
	maxEventBufferBytes: Domain.PositiveInt,
	maxObservationPayloadBytes: Domain.PositiveInt,
	maxRequestIdBytes: Domain.PositiveInt,
	maxReconnectAgeMs: Domain.PositiveInt,
}) {}

export const defaultPlotProtocolLimits = new PlotProtocolLimits({
	maxInputLineBytes: Domain.positiveInt(1024 * 1024),
	maxOutputRecordBytes: Domain.positiveInt(2 * 1024 * 1024),
	maxPendingRequests: Domain.positiveInt(64),
	maxEventBufferEvents: Domain.positiveInt(1024),
	maxEventBufferBytes: Domain.positiveInt(16 * 1024 * 1024),
	maxObservationPayloadBytes: Domain.positiveInt(512 * 1024),
	maxRequestIdBytes: Domain.positiveInt(128),
	maxReconnectAgeMs: Domain.positiveInt(5 * 60 * 1000),
});

export class SubscribeParams extends Schema.Class<SubscribeParams>(
	"SubscribeParams",
)({
	afterSequence: Schema.optionalKey(PlotProtocolSequence),
}) {}

export class SubmitObservationParams extends Schema.Class<SubmitObservationParams>(
	"SubmitObservationParams",
)({
	observation: Domain.Observation,
}) {}

export class PlotClientRequestRecord extends Schema.Class<PlotClientRequestRecord>(
	"PlotClientRequestRecord",
)({
	protocol: PlotProtocolVersion,
	kind: Schema.Literal("request"),
	id: PlotProtocolRequestId,
	command: PlotCommand,
	params: Schema.optionalKey(Schema.Unknown),
}) {}

export const PlotClientRecord = PlotClientRequestRecord;
export type PlotClientRecord = typeof PlotClientRecord.Type;

export class PlotHelloRecord extends Schema.Class<PlotHelloRecord>(
	"PlotHelloRecord",
)({
	protocol: PlotProtocolVersion,
	kind: Schema.Literal("hello"),
	sessionId: PlotSessionId,
	epoch: PlotProtocolEpoch,
	firstEventSeq: PlotProtocolSequence,
	lastEventSeq: PlotProtocolSequence,
	capabilities: Schema.Array(Schema.String),
	limits: PlotProtocolLimits,
}) {}

export class PlotEventRecord extends Schema.Class<PlotEventRecord>(
	"PlotEventRecord",
)({
	protocol: PlotProtocolVersion,
	kind: Schema.Literal("event"),
	sessionId: PlotSessionId,
	epoch: PlotProtocolEpoch,
	sequence: PlotSessionEventSequence,
	event: Schema.Unknown,
}) {}

export class PlotSuccessResponseRecord extends Schema.Class<PlotSuccessResponseRecord>(
	"PlotSuccessResponseRecord",
)({
	protocol: PlotProtocolVersion,
	kind: Schema.Literal("response"),
	id: PlotProtocolRequestId,
	command: PlotCommand,
	ok: Schema.Literal(true),
	lastEventSeq: PlotProtocolSequence,
	data: Schema.optionalKey(Schema.Unknown),
}) {}

export class PlotErrorPayload extends Schema.Class<PlotErrorPayload>(
	"PlotErrorPayload",
)({
	code: PlotProtocolErrorCode,
	message: Schema.String,
	details: Schema.optionalKey(Schema.Unknown),
}) {}

export class PlotErrorResponseRecord extends Schema.Class<PlotErrorResponseRecord>(
	"PlotErrorResponseRecord",
)({
	protocol: PlotProtocolVersion,
	kind: Schema.Literal("response"),
	id: Schema.optionalKey(PlotProtocolRequestId),
	command: Schema.optionalKey(Schema.String),
	ok: Schema.Literal(false),
	lastEventSeq: Schema.optionalKey(PlotProtocolSequence),
	error: PlotErrorPayload,
}) {}

export const PlotServerRecord = Schema.Union([
	PlotHelloRecord,
	PlotEventRecord,
	PlotSuccessResponseRecord,
	PlotErrorResponseRecord,
]);
export type PlotServerRecord = typeof PlotServerRecord.Type;

export const decodePlotClientRecord = (
	value: unknown,
): Effect.Effect<PlotClientRecord, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(PlotClientRecord)(value).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

export const decodePlotServerRecord = (
	value: unknown,
): Effect.Effect<PlotServerRecord, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(PlotServerRecord)(value).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

export const makePlotEventRecord = (
	epoch: PlotProtocolEpoch,
	event: PlotSessionEventType,
): PlotEventRecord =>
	new PlotEventRecord({
		protocol: "plot.v1",
		kind: "event",
		sessionId: event.sessionId,
		epoch,
		sequence: event.sequence,
		event,
	});

export const makePlotSuccessResponse = (options: {
	readonly id: PlotProtocolRequestId;
	readonly command: PlotCommand;
	readonly lastEventSeq: PlotProtocolSequence;
	readonly data?: unknown;
}): PlotSuccessResponseRecord =>
	new PlotSuccessResponseRecord({
		protocol: "plot.v1",
		kind: "response",
		id: options.id,
		command: options.command,
		ok: true,
		lastEventSeq: options.lastEventSeq,
		...(options.data === undefined ? {} : { data: options.data }),
	});

export const makePlotErrorResponse = (options: {
	readonly code: PlotProtocolErrorCode;
	readonly message: string;
	readonly id?: PlotProtocolRequestId;
	readonly command?: string;
	readonly lastEventSeq?: PlotProtocolSequence;
	readonly details?: unknown;
}): PlotErrorResponseRecord =>
	new PlotErrorResponseRecord({
		protocol: "plot.v1",
		kind: "response",
		...(options.id === undefined ? {} : { id: options.id }),
		...(options.command === undefined ? {} : { command: options.command }),
		ok: false,
		...(options.lastEventSeq === undefined
			? {}
			: { lastEventSeq: options.lastEventSeq }),
		error: new PlotErrorPayload({
			code: options.code,
			message: options.message,
			...(options.details === undefined ? {} : { details: options.details }),
		}),
	});
