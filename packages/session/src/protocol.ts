import { AsyncQueue } from "@plot/common/async-queue";
import {
	JsonlBoundaryError,
	parseJsonl,
	stringifyJsonl,
} from "@plot/common/jsonl";
import {
	byteLength,
	errorMessage,
	isRecord,
	type Mutable,
} from "@plot/common/primitives";
import {
	startOwnedTask,
	type OperatorObservationInput,
	type OwnedTask,
	type RuntimeEvent,
	type SessionRuntime,
} from "./runtime.js";

export const sessionProtocolVersion = "plot.session.v4";

export const sessionProtocolMethods = [
	"ping",
	"session.start",
	"session.shutdown",
	"session.snapshot",
	"session.tick",
	"session.dispatch.pause",
	"session.dispatch.resume",
	"agent.interrupt",
	"operator.observe",
] as const;

export type SessionProtocolMethod = (typeof sessionProtocolMethods)[number];

export const sessionProtocolSchema = {
	protocol: sessionProtocolVersion,
	schemaVersion: 1,
	transport: "jsonl",
	request: {
		kind: "request",
		id: "string",
		method: [...sessionProtocolMethods],
		params: "method-specific object",
	},
	records: {
		welcome: ["protocol", "kind", "sessionId", "limits"],
		event: ["protocol", "kind", "event"],
		response: ["protocol", "kind", "id", "method", "ok", "data", "error"],
	},
} as const;

export interface ProtocolLimits {
	readonly maxInputLineBytes: number;
	readonly maxOutputLineBytes: number;
	readonly maxPendingRequests: number;
	readonly maxBufferedEvents: number;
}

export const defaultProtocolLimits: ProtocolLimits = {
	maxInputLineBytes: 1024 * 1024,
	maxOutputLineBytes: 2 * 1024 * 1024,
	maxPendingRequests: 64,
	maxBufferedEvents: 1024,
};

export interface ClientRequest {
	readonly protocol: typeof sessionProtocolVersion;
	readonly kind: "request";
	readonly id: string;
	readonly method: SessionProtocolMethod;
	readonly params?: unknown;
}

export interface WelcomeRecord {
	readonly protocol: typeof sessionProtocolVersion;
	readonly kind: "welcome";
	readonly sessionId: string;
	readonly limits: ProtocolLimits;
}

export interface EventRecord {
	readonly protocol: typeof sessionProtocolVersion;
	readonly kind: "event";
	readonly event: RuntimeEvent;
}

export interface SuccessResponse {
	readonly protocol: typeof sessionProtocolVersion;
	readonly kind: "response";
	readonly id: string;
	readonly method: SessionProtocolMethod;
	readonly ok: true;
	readonly lastSequence?: number;
	readonly data?: unknown;
}

export type ProtocolErrorCode =
	| "parse_error"
	| "invalid_request"
	| "payload_too_large"
	| "request_queue_full"
	| "session_closed"
	| "internal_error";

export interface ErrorResponse {
	readonly protocol: typeof sessionProtocolVersion;
	readonly kind: "response";
	readonly id?: string;
	readonly method?: SessionProtocolMethod;
	readonly ok: false;
	readonly error: {
		readonly code: ProtocolErrorCode;
		readonly message: string;
		readonly details?: unknown;
	};
}

export type ServerRecord =
	| WelcomeRecord
	| EventRecord
	| SuccessResponse
	| ErrorResponse;

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

const asSessionProtocolMethod = (
	value: unknown,
): SessionProtocolMethod | undefined =>
	sessionProtocolMethods.find((method) => method === value);

const requireString = (label: string, value: unknown): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw new ProtocolBoundaryError({
		code: "invalid_request",
		message: `${label} must be a non-empty string`,
	});
};

const requirePositiveInteger = (label: string, value: unknown): number => {
	if (typeof value === "number" && Number.isInteger(value) && value > 0)
		return value;
	throw new ProtocolBoundaryError({
		code: "invalid_request",
		message: `${label} must be a positive integer`,
	});
};

const decodeProtocolLimits = (value: unknown): ProtocolLimits => {
	if (!isRecord(value))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "protocol limits must be an object",
		});
	return {
		maxInputLineBytes: requirePositiveInteger(
			"maxInputLineBytes",
			value["maxInputLineBytes"],
		),
		maxOutputLineBytes: requirePositiveInteger(
			"maxOutputLineBytes",
			value["maxOutputLineBytes"],
		),
		maxPendingRequests: requirePositiveInteger(
			"maxPendingRequests",
			value["maxPendingRequests"],
		),
		maxBufferedEvents: requirePositiveInteger(
			"maxBufferedEvents",
			value["maxBufferedEvents"],
		),
	};
};

const protocolErrorCodes = [
	"parse_error",
	"invalid_request",
	"payload_too_large",
	"request_queue_full",
	"session_closed",
	"internal_error",
] as const satisfies readonly ProtocolErrorCode[];

const decodeProtocolErrorCode = (value: unknown): ProtocolErrorCode => {
	const code = protocolErrorCodes.find((candidate) => candidate === value);
	if (code !== undefined) return code;
	throw new ProtocolBoundaryError({
		code: "invalid_request",
		message: `unknown protocol error code: ${String(value)}`,
	});
};

const assertProtocolVersion = (value: Record<string, unknown>): void => {
	if (value["protocol"] === sessionProtocolVersion) return;
	throw new ProtocolBoundaryError({
		code: "invalid_request",
		message: `unsupported protocol ${JSON.stringify(value["protocol"])}; this build speaks ${sessionProtocolVersion} (a stale plot daemon or child may need a restart)`,
	});
};

export const decodeClientRequest = (value: unknown): ClientRequest => {
	if (!isRecord(value))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "request must be an object",
		});
	assertProtocolVersion(value);
	if (value["kind"] !== "request")
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: `unknown request kind: ${String(value["kind"])}`,
		});
	const id = value["id"];
	if (typeof id !== "string" || id.length === 0 || id.length > 128)
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "request id must be a non-empty string of at most 128 chars",
		});
	const method = asSessionProtocolMethod(value["method"]);
	if (method === undefined)
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: `unknown method: ${String(value["method"])}`,
		});
	const request: Mutable<ClientRequest> = {
		protocol: sessionProtocolVersion,
		kind: "request",
		id,
		method,
	};
	if (value["params"] !== undefined) request.params = value["params"];
	return request;
};

export const decodeServerRecord = (value: unknown): ServerRecord => {
	if (!isRecord(value))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "server record must be an object",
		});
	assertProtocolVersion(value);
	const kind = value["kind"];
	if (kind === "welcome")
		return {
			protocol: sessionProtocolVersion,
			kind,
			sessionId: requireString("sessionId", value["sessionId"]),
			limits: decodeProtocolLimits(value["limits"]),
		};
	if (kind === "event")
		return {
			protocol: sessionProtocolVersion,
			kind,
			event: value["event"] as RuntimeEvent,
		};
	if (kind !== "response")
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: `unknown server record kind: ${String(kind)}`,
		});
	if (value["ok"] === true) {
		const method = asSessionProtocolMethod(value["method"]);
		if (method === undefined)
			throw new ProtocolBoundaryError({
				code: "invalid_request",
				message: `unknown method: ${String(value["method"])}`,
			});
		const response: Mutable<SuccessResponse> = {
			protocol: sessionProtocolVersion,
			kind,
			id: requireString("response id", value["id"]),
			method,
			ok: true,
		};
		if (typeof value["lastSequence"] === "number")
			response.lastSequence = value["lastSequence"];
		if (value["data"] !== undefined) response.data = value["data"];
		return response;
	}
	if (value["ok"] === false) {
		const errorValue = value["error"];
		if (!isRecord(errorValue))
			throw new ProtocolBoundaryError({
				code: "invalid_request",
				message: "error response requires an error object",
			});
		const error: Mutable<ErrorResponse["error"]> = {
			code: decodeProtocolErrorCode(errorValue["code"]),
			message: requireString("error message", errorValue["message"]),
		};
		if (errorValue["details"] !== undefined)
			error.details = errorValue["details"];
		const response: Mutable<ErrorResponse> = {
			protocol: sessionProtocolVersion,
			kind,
			ok: false,
			error,
		};
		if (typeof value["id"] === "string" && value["id"].length > 0)
			response.id = value["id"];
		const method = asSessionProtocolMethod(value["method"]);
		if (method !== undefined) response.method = method;
		return response;
	}
	throw new ProtocolBoundaryError({
		code: "invalid_request",
		message: "response ok must be true or false",
	});
};

const mapJsonlError = (error: unknown): ProtocolBoundaryError => {
	if (error instanceof ProtocolBoundaryError) return error;
	if (error instanceof JsonlBoundaryError) {
		const boundary = new ProtocolBoundaryError({
			code: error.code === "parse_error" ? "parse_error" : "payload_too_large",
			message: error.message,
		});
		return boundary;
	}
	return new ProtocolBoundaryError({
		code: "invalid_request",
		message: errorMessage(error),
	});
};

const assertInputLineSize = (line: string, limits: ProtocolLimits): void => {
	const bytes = byteLength(line);
	if (bytes <= limits.maxInputLineBytes) return;
	throw new ProtocolBoundaryError({
		code: "payload_too_large",
		message: "protocol input line exceeds maxInputLineBytes",
		details: { bytes, maxInputLineBytes: limits.maxInputLineBytes },
	});
};

export const encodeServerRecordLine = (
	record: ServerRecord,
	limits: ProtocolLimits = defaultProtocolLimits,
): string => {
	try {
		return stringifyJsonl(record, { maxLineBytes: limits.maxOutputLineBytes });
	} catch (error) {
		throw mapJsonlError(error);
	}
};

export const decodeClientRequestLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ClientRequest => {
	try {
		assertInputLineSize(line, limits);
		return decodeClientRequest(parseJsonl(line));
	} catch (error) {
		throw mapJsonlError(error);
	}
};

export const decodeServerRecordLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ServerRecord => {
	try {
		assertInputLineSize(line, limits);
		return decodeServerRecord(parseJsonl(line));
	} catch (error) {
		throw mapJsonlError(error);
	}
};

export const makeWelcome = (input: {
	readonly sessionId: string;
	readonly limits: ProtocolLimits;
}): ServerRecord => ({
	protocol: sessionProtocolVersion,
	kind: "welcome",
	sessionId: input.sessionId,
	limits: input.limits,
});

export const makeSuccess = (input: {
	readonly request: ClientRequest;
	readonly lastSequence?: number;
	readonly data?: unknown;
}): ServerRecord => {
	const response: {
		protocol: typeof sessionProtocolVersion;
		kind: "response";
		id: string;
		method: SessionProtocolMethod;
		ok: true;
		lastSequence?: number;
		data?: unknown;
	} = {
		protocol: sessionProtocolVersion,
		kind: "response",
		id: input.request.id,
		method: input.request.method,
		ok: true,
	};
	if (input.lastSequence !== undefined)
		response.lastSequence = input.lastSequence;
	if (input.data !== undefined) response.data = input.data;
	return response;
};

export const makeError = (input: {
	readonly request?: ClientRequest;
	readonly code: ProtocolErrorCode;
	readonly message: string;
	readonly details?: unknown;
}): ServerRecord => {
	const error: { code: ProtocolErrorCode; message: string; details?: unknown } =
		{
			code: input.code,
			message: input.message,
		};
	if (input.details !== undefined) error.details = input.details;
	const response: {
		protocol: typeof sessionProtocolVersion;
		kind: "response";
		id?: string;
		method?: SessionProtocolMethod;
		ok: false;
		error: typeof error;
	} = {
		protocol: sessionProtocolVersion,
		kind: "response",
		ok: false,
		error,
	};
	if (input.request !== undefined) {
		response.id = input.request.id;
		response.method = input.request.method;
	}
	return response;
};

const decodeInterruptParams = (
	params: unknown,
): { runId: string; workKey?: string } => {
	if (
		!isRecord(params) ||
		typeof params["runId"] !== "string" ||
		params["runId"].length === 0
	)
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "agent.interrupt requires a non-empty runId",
		});
	const input: { runId: string; workKey?: string } = { runId: params["runId"] };
	if (typeof params["workKey"] === "string" && params["workKey"].length > 0)
		input.workKey = params["workKey"];
	return input;
};

const decodeObservationParams = (params: unknown): OperatorObservationInput => {
	if (!isRecord(params))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "operator.observe requires params",
		});
	for (const key of [
		"sourceId",
		"workKey",
		"actionId",
		"actionLabel",
	] as const) {
		const value = params[key];
		if (typeof value !== "string" || value.length === 0)
			throw new ProtocolBoundaryError({
				code: "invalid_request",
				message: `operator.observe requires a non-empty ${key}`,
			});
	}
	const input: {
		sourceId: string;
		workKey: string;
		actionId: string;
		actionLabel: string;
		comment?: string;
		clientId?: string;
		actor?: string;
	} = {
		sourceId: params["sourceId"] as string,
		workKey: params["workKey"] as string,
		actionId: params["actionId"] as string,
		actionLabel: params["actionLabel"] as string,
	};
	if (typeof params["comment"] === "string") input.comment = params["comment"];
	if (typeof params["clientId"] === "string" && params["clientId"].length > 0)
		input.clientId = params["clientId"];
	if (typeof params["actor"] === "string" && params["actor"].length > 0)
		input.actor = params["actor"];
	return input;
};

export interface SessionProtocol {
	readonly welcome: () => Promise<ServerRecord>;
	readonly submit: (request: ClientRequest) => Promise<boolean>;
	readonly output: () => AsyncIterable<ServerRecord>;
	readonly close: () => Promise<void>;
	readonly done: Promise<void>;
}

export interface SessionProtocolOptions {
	readonly runtime: SessionRuntime;
	readonly limits?: ProtocolLimits;
}

interface QueuedRequest {
	readonly request: ClientRequest;
	readonly resolve: (accepted: boolean) => void;
}

const toErrorResponse = (
	request: ClientRequest,
	error: unknown,
): ServerRecord => {
	if (error instanceof ProtocolBoundaryError)
		return makeError({
			request,
			code: error.code,
			message: error.message,
			details: error.details,
		});
	return makeError({
		request,
		code: "internal_error",
		message: errorMessage(error),
	});
};

const publishResponse = (
	output: AsyncQueue<ServerRecord>,
	record: ServerRecord,
): void => {
	output.offer(record, { force: true });
};

const publishEvent = (
	output: AsyncQueue<ServerRecord>,
	record: ServerRecord,
): void => {
	output.offer(record);
};

export const makeSessionProtocol = (
	options: SessionProtocolOptions,
): SessionProtocol => {
	const limits = options.limits ?? defaultProtocolLimits;
	const output = new AsyncQueue<ServerRecord>({
		capacity: limits.maxBufferedEvents + limits.maxPendingRequests,
		overflow: "drop-oldest",
	});
	const requests = new AsyncQueue<QueuedRequest>({
		capacity: limits.maxPendingRequests,
		overflow: "reject",
	});
	let closed = false;

	const handleRequest = async (
		request: ClientRequest,
	): Promise<ServerRecord> => {
		switch (request.method) {
			case "ping":
				return makeSuccess({ request, data: { pong: true } });
			case "session.start":
				await options.runtime.start();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { started: true },
				});
			case "session.shutdown":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { accepted: await options.runtime.shutdown() },
				});
			case "session.snapshot":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: await options.runtime.state(),
				});
			case "session.tick":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { result: await options.runtime.tickOnce() },
				});
			case "session.dispatch.pause":
				await options.runtime.pauseDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { paused: true },
				});
			case "session.dispatch.resume":
				await options.runtime.resumeDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { resumed: true },
				});
			case "operator.observe": {
				const params = decodeObservationParams(request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						accepted: await options.runtime.recordOperatorObservation(params),
					},
				});
			}
			case "agent.interrupt": {
				const params = decodeInterruptParams(request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						accepted: await options.runtime.interruptAgentRun(params),
					},
				});
			}
		}
	};

	const eventPump = startOwnedTask({
		name: "session.protocol.events",
		run: async (signal) => {
			for await (const event of options.runtime.events()) {
				if (signal.aborted) return;
				publishEvent(output, {
					protocol: sessionProtocolVersion,
					kind: "event",
					event,
				});
			}
		},
	});

	const requestPump = startOwnedTask({
		name: "session.protocol.requests",
		run: async (signal) => {
			while (!signal.aborted) {
				let queued: QueuedRequest;
				try {
					// eslint-disable-next-line no-await-in-loop -- protocol requests are queued and processed in order.
					queued = await requests.take();
				} catch {
					return;
				}
				// eslint-disable-next-line no-await-in-loop -- each response belongs to the current queued request.
				const record = await handleRequest(queued.request).catch((error) =>
					toErrorResponse(queued.request, error),
				);
				publishResponse(output, record);
				queued.resolve(record.kind === "response" && record.ok);
			}
		},
	});

	const tasks: readonly OwnedTask[] = [eventPump, requestPump];
	const done = Promise.all(tasks.map((task) => task.done)).then(
		() => undefined,
	);

	return {
		welcome: async () => makeWelcome({ sessionId: options.runtime.id, limits }),
		submit: async (request) => {
			if (closed) return false;
			return new Promise<boolean>((resolve) => {
				const accepted = requests.offer({ request, resolve });
				if (accepted) return;
				publishResponse(
					output,
					makeError({
						request,
						code: "request_queue_full",
						message: "protocol request queue is full",
					}),
				);
				resolve(false);
			});
		},
		output: () => output,
		close: async () => {
			if (closed) return;
			closed = true;
			requests.close();
			await Promise.all(tasks.map((task) => task.stop()));
			output.close();
			await done;
		},
		done,
	};
};
