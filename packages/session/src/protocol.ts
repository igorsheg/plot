import type { Observation } from "@plot/agent/model";
import { positiveInt, type PositiveInt } from "@plot/agent/model";
import {
	safeParsePlotClientRecord,
	safeParsePlotServerRecord,
} from "@plot/control/protocol";
import { Result, TaggedError } from "better-result";
import type {
	PlotSessionEventSequence,
	PlotSessionId,
	PlotSessionEvent as PlotSessionEventType,
} from "./plot-session.js";

export type PlotProtocolVersion = "plot.v1";
export type PlotProtocolRequestId = string;
export const plotProtocolRequestId = (value: string): PlotProtocolRequestId => {
	if (typeof value !== "string" || value.length === 0 || value.length > 128)
		throw new Error("invalid request id");
	return value;
};
export type PlotProtocolEpoch = string;
export const plotProtocolEpoch = (value: string): PlotProtocolEpoch => {
	if (typeof value !== "string" || value.length === 0 || value.length > 128)
		throw new Error("invalid epoch");
	return value;
};
export type PlotProtocolSequence = number;
export const plotProtocolSequence = (value: number): PlotProtocolSequence => {
	if (!Number.isInteger(value) || value < 0)
		throw new Error("invalid protocol sequence");
	return value;
};
export type PlotCommand =
	| "start"
	| "tick_once"
	| "submit_observation"
	| "get_snapshot"
	| "subscribe"
	| "shutdown"
	| "ping"
	| "auth_providers"
	| "auth_status"
	| "auth_login"
	| "auth_logout";
export type PlotProtocolErrorCode =
	| "parse_error"
	| "invalid_request"
	| "unknown_command"
	| "payload_too_large"
	| "request_queue_full"
	| "not_started"
	| "already_started"
	| "shutdown_requested"
	| "session_shutdown"
	| "tick_in_progress"
	| "cursor_expired"
	| "snapshot_unavailable"
	| "auth_unavailable"
	| "auth_input_required"
	| "internal_error";
export class PlotProtocolFailure extends TaggedError("PlotProtocolFailure")<{
	readonly code: PlotProtocolErrorCode;
	readonly message: string;
	readonly details?: unknown;
}>() {}
export interface PlotProtocolLimits {
	readonly maxInputLineBytes: PositiveInt;
	readonly maxOutputRecordBytes: PositiveInt;
	readonly maxPendingRequests: PositiveInt;
	readonly maxEventBufferEvents: PositiveInt;
	readonly maxEventBufferBytes: PositiveInt;
	readonly maxObservationPayloadBytes: PositiveInt;
	readonly maxRequestIdBytes: PositiveInt;
	readonly maxReconnectAgeMs: PositiveInt;
}
export const defaultPlotProtocolLimits: PlotProtocolLimits = {
	maxInputLineBytes: positiveInt(1024 * 1024),
	maxOutputRecordBytes: positiveInt(2 * 1024 * 1024),
	maxPendingRequests: positiveInt(64),
	maxEventBufferEvents: positiveInt(1024),
	maxEventBufferBytes: positiveInt(16 * 1024 * 1024),
	maxObservationPayloadBytes: positiveInt(512 * 1024),
	maxRequestIdBytes: positiveInt(128),
	maxReconnectAgeMs: positiveInt(5 * 60 * 1000),
};
export interface SubscribeParams {
	readonly afterSequence?: PlotProtocolSequence | undefined;
}
export interface SubmitObservationParams {
	readonly observation: Observation;
}
export interface AuthProviderParams {
	readonly provider: string;
}
export interface AuthStatusParams {
	readonly provider?: string | undefined;
}
export interface AuthLoginParams {
	readonly provider: string;
	readonly promptResponses?: readonly string[] | undefined;
	readonly selectResponse?: string | undefined;
	readonly manualCode?: string | undefined;
}
export interface PlotClientRequestRecord {
	readonly protocol: PlotProtocolVersion;
	readonly kind: "request";
	readonly id: PlotProtocolRequestId;
	readonly command: PlotCommand;
	readonly params?: unknown;
}
export type PlotClientRecord = PlotClientRequestRecord;
export class PlotHelloRecord {
	readonly protocol = "plot.v1";
	readonly kind = "hello";
	readonly sessionId!: PlotSessionId;
	readonly epoch!: PlotProtocolEpoch;
	readonly firstEventSeq!: PlotProtocolSequence;
	readonly lastEventSeq!: PlotProtocolSequence;
	readonly capabilities!: readonly string[];
	readonly limits!: PlotProtocolLimits;
	constructor(input: Omit<PlotHelloRecord, "protocol" | "kind">) {
		Object.assign(this, input);
	}
}
export class PlotEventRecord {
	readonly protocol = "plot.v1";
	readonly kind = "event";
	readonly sessionId!: PlotSessionId;
	readonly epoch!: PlotProtocolEpoch;
	readonly sequence!: PlotSessionEventSequence;
	readonly event: unknown;
	constructor(input: Omit<PlotEventRecord, "protocol" | "kind">) {
		Object.assign(this, input);
	}
}
export class PlotSuccessResponseRecord {
	readonly protocol = "plot.v1";
	readonly kind = "response";
	readonly id!: PlotProtocolRequestId;
	readonly command!: PlotCommand;
	readonly ok = true;
	readonly lastEventSeq!: PlotProtocolSequence;
	readonly data?: unknown;
	constructor(
		input: Omit<PlotSuccessResponseRecord, "protocol" | "kind" | "ok">,
	) {
		Object.assign(this, input);
	}
}
export class PlotErrorPayload {
	readonly code!: PlotProtocolErrorCode;
	readonly message!: string;
	readonly details?: unknown;
	constructor(input: PlotErrorPayload) {
		Object.assign(this, input);
	}
}
export class PlotErrorResponseRecord {
	readonly protocol = "plot.v1";
	readonly kind = "response";
	readonly id?: PlotProtocolRequestId;
	readonly command?: string;
	readonly ok = false;
	readonly lastEventSeq?: PlotProtocolSequence;
	readonly error!: PlotErrorPayload;
	constructor(
		input: Omit<PlotErrorResponseRecord, "protocol" | "kind" | "ok">,
	) {
		Object.assign(this, input);
	}
}
export type PlotServerRecord =
	| PlotHelloRecord
	| PlotEventRecord
	| PlotSuccessResponseRecord
	| PlotErrorResponseRecord;

type ProtocolParseIssue = {
	readonly path: readonly PropertyKey[];
	readonly message: string;
};

export const formatProtocolParseIssues = (
	issues: readonly ProtocolParseIssue[],
): string =>
	issues
		.map((issue) => {
			const path =
				issue.path.length === 0
					? "record"
					: issue.path.map((part) => String(part)).join(".");
			return `${path}: ${issue.message}`;
		})
		.join("; ");

export const decodePlotClientRecordResult = (
	value: unknown,
): Result<PlotClientRecord, PlotProtocolFailure> =>
	Result.try({
		try: () => {
			const parsed = safeParsePlotClientRecord(value);
			if (!parsed.success)
				throw new Error(formatProtocolParseIssues(parsed.error.issues));
			return parsed.data as PlotClientRecord;
		},
		catch: (error) =>
			new PlotProtocolFailure({
				code: "invalid_request",
				message: error instanceof Error ? error.message : String(error),
			}),
	});
export const decodePlotClientRecord = async (
	value: unknown,
): Promise<PlotClientRecord> => {
	const result = decodePlotClientRecordResult(value);
	if (Result.isError(result)) throw result.error;
	return result.value;
};
export const decodePlotServerRecordResult = (
	value: unknown,
): Result<PlotServerRecord, PlotProtocolFailure> =>
	Result.try({
		try: () => {
			const parsed = safeParsePlotServerRecord(value);
			if (!parsed.success)
				throw new Error(formatProtocolParseIssues(parsed.error.issues));
			return parsed.data as PlotServerRecord;
		},
		catch: (error) =>
			new PlotProtocolFailure({
				code: "invalid_request",
				message: error instanceof Error ? error.message : String(error),
			}),
	});
export const decodePlotServerRecord = async (
	value: unknown,
): Promise<PlotServerRecord> => {
	const result = decodePlotServerRecordResult(value);
	if (Result.isError(result)) throw result.error;
	return result.value;
};
export const makePlotEventRecord = (
	epoch: PlotProtocolEpoch,
	event: PlotSessionEventType,
): PlotEventRecord =>
	new PlotEventRecord({
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
		id: options.id,
		command: options.command,
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
		...(options.id === undefined ? {} : { id: options.id }),
		...(options.command === undefined ? {} : { command: options.command }),
		...(options.lastEventSeq === undefined
			? {}
			: { lastEventSeq: options.lastEventSeq }),
		error: new PlotErrorPayload({
			code: options.code,
			message: options.message,
			...(options.details === undefined ? {} : { details: options.details }),
		}),
	});
