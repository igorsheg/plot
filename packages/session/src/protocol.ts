import { AsyncQueue } from "@plot/common/async-queue";
import {
	JsonlBoundaryError,
	parseJsonl,
	stringifyJsonl,
} from "@plot/common/jsonl";
import { byteLength, errorMessage, isRecord } from "@plot/common/primitives";
import {
	startOwnedTask,
	type OperatorObservationInput,
	type OwnedTask,
	type RuntimeEvent,
	type SessionRuntime,
} from "./runtime.js";

export const sessionProtocolVersion = "plot.session.v3";

const sessionCommands = [
	"ping",
	"start",
	"shutdown",
	"get_state",
	"get_snapshot",
	"request_tick",
	"pause_dispatch",
	"resume_dispatch",
	"interrupt_agent_run",
	"record_operator_observation",
] as const;

export type SessionCommand = (typeof sessionCommands)[number];

const sessionCommandSet: ReadonlySet<string> = new Set(sessionCommands);

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
	readonly command: SessionCommand;
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
	readonly command: SessionCommand;
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
	readonly command?: SessionCommand;
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
	const command = value["command"];
	if (typeof command !== "string" || !sessionCommandSet.has(command))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: `unknown command: ${String(command)}`,
		});
	return value as unknown as ClientRequest;
};

const serverRecordKinds = new Set(["welcome", "event", "response"]);

export const decodeServerRecord = (value: unknown): ServerRecord => {
	if (!isRecord(value))
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "server record must be an object",
		});
	assertProtocolVersion(value);
	if (
		typeof value["kind"] !== "string" ||
		!serverRecordKinds.has(value["kind"])
	)
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: `unknown server record kind: ${String(value["kind"])}`,
		});
	return value as unknown as ServerRecord;
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
		command: SessionCommand;
		ok: true;
		lastSequence?: number;
		data?: unknown;
	} = {
		protocol: sessionProtocolVersion,
		kind: "response",
		id: input.request.id,
		command: input.request.command,
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
		command?: SessionCommand;
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
		response.command = input.request.command;
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
			message: "interrupt_agent_run requires a non-empty runId",
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
			message: "record_operator_observation requires params",
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
				message: `record_operator_observation requires a non-empty ${key}`,
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
		switch (request.command) {
			case "ping":
				return makeSuccess({ request, data: { pong: true } });
			case "start":
				await options.runtime.start();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { started: true },
				});
			case "shutdown":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { accepted: await options.runtime.shutdown() },
				});
			case "get_state":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: await options.runtime.state(),
				});
			case "get_snapshot":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						snapshot: await options.runtime.snapshot(),
						lastSequence: await options.runtime.lastEventSequence(),
					},
				});
			case "request_tick":
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { result: await options.runtime.tickOnce() },
				});
			case "pause_dispatch":
				await options.runtime.pauseDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { paused: true },
				});
			case "resume_dispatch":
				await options.runtime.resumeDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { resumed: true },
				});
			case "record_operator_observation": {
				const params = decodeObservationParams(request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						accepted: await options.runtime.recordOperatorObservation(params),
					},
				});
			}
			case "interrupt_agent_run": {
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
					queued = await requests.take();
				} catch {
					return;
				}
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
