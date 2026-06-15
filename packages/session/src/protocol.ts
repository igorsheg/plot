import { positiveInt, type PositiveInt } from "@plot/agent/model";
import {
	plotControlProtocolVersion,
	type PlotControlProtocolVersion,
} from "@plot/control";
import {
	safeParsePlotClientRecord,
	safeParsePlotServerRecord,
	type AuthLoginParams,
	type AuthProviderParams,
	type AuthStatusParams,
	type AttachSessionParams,
	type CloseSessionParams,
	type ControlConnectionRole,
	type DetachSessionParams,
	type GetSnapshotParams,
	type InterruptAgentRunParams,
	type OpenSessionParams,
	type PauseSessionParams,
	type PerformOperatorActionParams,
	type PlotClientRecord,
	type PlotCommand,
	type PlotErrorPayload as PlotErrorPayloadType,
	type PlotProtocolErrorCode,
	type PlotProtocolEpoch,
	type PlotProtocolLimits,
	type PlotProtocolRequestId,
	type PlotProtocolSequence,
	type PlotRosterEventRecord as PlotRosterEventRecordType,
	type PlotServerRecord,
	type PlotSessionEventRecord as PlotSessionEventRecordType,
	type PlotSuccessResponseRecord as PlotSuccessResponseRecordType,
	type PlotWelcomeRecord as PlotWelcomeRecordType,
	type RequestTickParams,
	type ResumeSessionParams,
	plotProtocolEpoch as parsePlotProtocolEpoch,
	plotProtocolRequestId as parsePlotProtocolRequestId,
	plotProtocolSequence as parsePlotProtocolSequence,
} from "@plot/control/protocol";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Result, TaggedError } from "better-result";

export type { AuthLoginParams, AuthProviderParams, AuthStatusParams };
export type { AttachSessionParams, CloseSessionParams, ControlConnectionRole };
export type { DetachSessionParams, GetSnapshotParams };
export type { InterruptAgentRunParams, OpenSessionParams };
export type { PauseSessionParams, PerformOperatorActionParams };
export type { PlotClientRecord, PlotCommand };
export type { PlotProtocolErrorCode, PlotProtocolEpoch, PlotProtocolLimits };
export type { PlotProtocolRequestId, PlotProtocolSequence };
export type {
	PlotRosterEventRecordType,
	PlotServerRecord,
	PlotSessionEventRecordType,
};
export type { PlotSuccessResponseRecordType, PlotWelcomeRecordType };
export type { RequestTickParams, ResumeSessionParams };

export type PlotProtocolVersion = PlotControlProtocolVersion;
export const plotProtocolVersion: PlotProtocolVersion =
	plotControlProtocolVersion;
export const plotProtocolRequestId = parsePlotProtocolRequestId;
export const plotProtocolEpoch = parsePlotProtocolEpoch;
export const plotProtocolSequence = parsePlotProtocolSequence;

export class PlotProtocolFailure extends TaggedError("PlotProtocolFailure")<{
	readonly code: PlotProtocolErrorCode;
	readonly message: string;
	readonly details?: unknown;
}>() {}

export const defaultPlotProtocolLimits: PlotProtocolLimits = {
	maxInputLineBytes: positiveInt(1024 * 1024) as PositiveInt,
	maxOutputRecordBytes: positiveInt(2 * 1024 * 1024) as PositiveInt,
	maxPendingRequests: positiveInt(64) as PositiveInt,
	maxEventBufferEvents: positiveInt(1024) as PositiveInt,
	maxEventBufferBytes: positiveInt(16 * 1024 * 1024) as PositiveInt,
	maxObservationPayloadBytes: positiveInt(512 * 1024) as PositiveInt,
	maxRequestIdBytes: positiveInt(128) as PositiveInt,
	maxReconnectAgeMs: positiveInt(5 * 60 * 1000) as PositiveInt,
};

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

export class PlotWelcomeRecord {
	readonly protocol = plotControlProtocolVersion;
	readonly kind = "welcome";
	readonly connectionId!: string;
	readonly capabilities!: string[];
	readonly limits!: PlotProtocolLimits;
	readonly identity?: unknown;
	constructor(input: Omit<PlotWelcomeRecord, "protocol" | "kind">) {
		Object.assign(this, input);
	}
}

export class PlotSessionEventRecord {
	readonly protocol = plotControlProtocolVersion;
	readonly kind = "session_event";
	readonly sessionId!: string;
	readonly epoch!: PlotProtocolEpoch;
	readonly sequence!: number;
	readonly event!: SessionHistoryEvent;
	constructor(input: Omit<PlotSessionEventRecord, "protocol" | "kind">) {
		Object.assign(this, input);
	}
}

export class PlotRosterEventRecord {
	readonly protocol = plotControlProtocolVersion;
	readonly kind = "roster_event";
	readonly event!: "session_opened" | "session_changed" | "session_closed";
	readonly session!: PlotSessionSummary;
	constructor(input: Omit<PlotRosterEventRecord, "protocol" | "kind">) {
		Object.assign(this, input);
	}
}

export class PlotSuccessResponseRecord {
	readonly protocol = plotControlProtocolVersion;
	readonly kind = "response";
	readonly id!: PlotProtocolRequestId;
	readonly command!: PlotCommand;
	readonly ok = true;
	readonly asOfSequence?: PlotProtocolSequence;
	readonly lastSequence?: PlotProtocolSequence;
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
	constructor(input: PlotErrorPayloadType) {
		Object.assign(this, input);
	}
}

export class PlotErrorResponseRecord {
	readonly protocol = plotControlProtocolVersion;
	readonly kind = "response";
	readonly id?: PlotProtocolRequestId;
	readonly command?: string;
	readonly ok = false;
	readonly asOfSequence?: PlotProtocolSequence;
	readonly lastSequence?: PlotProtocolSequence;
	readonly error!: PlotErrorPayloadType;
	constructor(
		input: Omit<PlotErrorResponseRecord, "protocol" | "kind" | "ok">,
	) {
		Object.assign(this, input);
	}
}

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

export const makePlotSessionEventRecord = (
	event: SessionHistoryEvent,
): PlotSessionEventRecord =>
	new PlotSessionEventRecord({
		sessionId: event.sessionId,
		epoch: plotProtocolEpoch(event.epoch),
		sequence: Number(event.sequence),
		event,
	});

export const makePlotSuccessResponse = (options: {
	readonly id: PlotProtocolRequestId;
	readonly command: PlotCommand;
	readonly asOfSequence?: PlotProtocolSequence;
	readonly lastSequence?: PlotProtocolSequence;
	readonly data?: unknown;
}): PlotSuccessResponseRecord =>
	new PlotSuccessResponseRecord({
		id: options.id,
		command: options.command,
		...(options.asOfSequence === undefined
			? {}
			: { asOfSequence: options.asOfSequence }),
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
	readonly asOfSequence?: PlotProtocolSequence;
	readonly lastSequence?: PlotProtocolSequence;
	readonly details?: unknown;
}): PlotErrorResponseRecord =>
	new PlotErrorResponseRecord({
		...(options.id === undefined ? {} : { id: options.id }),
		...(options.command === undefined ? {} : { command: options.command }),
		...(options.asOfSequence === undefined
			? {}
			: { asOfSequence: options.asOfSequence }),
		...(options.lastSequence === undefined
			? {}
			: { lastSequence: options.lastSequence }),
		error: new PlotErrorPayload({
			code: options.code,
			message: options.message,
			...(options.details === undefined ? {} : { details: options.details }),
		}),
	});
