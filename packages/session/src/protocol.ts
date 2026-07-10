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

export const sessionProtocolVersion = "plot.session.v5";

export const sessionProtocolMethods = [
	"ping",
	"session.start",
	"session.shutdown",
	"session.snapshot",
	"session.tick",
	"session.dispatch.pause",
	"session.dispatch.resume",
	"scheduler.snapshot",
	"work.list",
	"work.get",
	"attempt.list",
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

export const toProtocolBoundaryError = (
	error: unknown,
): ProtocolBoundaryError => {
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
		throw toProtocolBoundaryError(error);
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
		throw toProtocolBoundaryError(error);
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
		throw toProtocolBoundaryError(error);
	}
};

export const makeWelcome = (input: {
	readonly sessionId: string;
	readonly limits: ProtocolLimits;
}): WelcomeRecord => ({
	protocol: sessionProtocolVersion,
	kind: "welcome",
	sessionId: input.sessionId,
	limits: input.limits,
});

export const makeSuccess = (input: {
	readonly request: ClientRequest;
	readonly lastSequence?: number;
	readonly data?: unknown;
}): SuccessResponse => {
	const response: Mutable<SuccessResponse> = {
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
}): ErrorResponse => {
	const error: Mutable<ErrorResponse["error"]> = {
		code: input.code,
		message: input.message,
	};
	if (input.details !== undefined) error.details = input.details;
	const response: Mutable<ErrorResponse> = {
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
	const input: Mutable<OperatorObservationInput> = {
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

const decodeWorkGetParams = (params: unknown): { workKey: string } => {
	if (
		!isRecord(params) ||
		typeof params["workKey"] !== "string" ||
		params["workKey"].length === 0
	)
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: "work.get requires a non-empty workKey",
		});
	return { workKey: params["workKey"] };
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
	readonly shutdown?: () => Promise<boolean> | boolean;
}

interface QueuedRequest {
	readonly request: ClientRequest;
	readonly resolve: (accepted: boolean) => void;
}

const toErrorResponse = (
	request: ClientRequest,
	error: unknown,
): ErrorResponse => {
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

type ResponseRecord = SuccessResponse | ErrorResponse;

interface WaitingResponse {
	readonly record: ResponseRecord;
	readonly resolve: (accepted: boolean) => void;
}

class ProtocolOutput implements AsyncIterable<ServerRecord> {
	private readonly records: ServerRecord[] = [];
	private readonly readers: ((result: IteratorResult<ServerRecord>) => void)[] =
		[];
	private waitingResponse: WaitingResponse | undefined;
	private closed = false;

	constructor(
		private readonly responseCapacity: number,
		private readonly eventCapacity: number,
	) {}

	offerEvent(record: EventRecord): boolean {
		if (this.closed) return false;
		const reader = this.readers.shift();
		if (reader !== undefined) {
			reader({ value: record, done: false });
			return true;
		}
		let eventCount = 0;
		let oldestEventIndex = -1;
		for (const [index, candidate] of this.records.entries()) {
			if (candidate.kind !== "event") continue;
			if (oldestEventIndex === -1) oldestEventIndex = index;
			eventCount++;
		}
		if (eventCount >= this.eventCapacity)
			this.records.splice(oldestEventIndex, 1);
		this.records.push(record);
		return true;
	}

	offerResponse(
		record: ResponseRecord,
		waitForCapacity = false,
	): Promise<boolean> {
		if (this.closed) return Promise.resolve(false);
		const reader = this.readers.shift();
		if (reader !== undefined) {
			reader({ value: record, done: false });
			return Promise.resolve(true);
		}
		if (this.responseCount() < this.responseCapacity) {
			this.records.push(record);
			return Promise.resolve(true);
		}
		if (!waitForCapacity || this.waitingResponse !== undefined)
			return Promise.resolve(false);
		return new Promise<boolean>((resolve) => {
			this.waitingResponse = { record, resolve };
		});
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.waitingResponse?.resolve(false);
		this.waitingResponse = undefined;
		if (this.records.length === 0)
			for (const reader of this.readers.splice(0))
				reader({ value: undefined, done: true });
	}

	private responseCount(): number {
		return this.records.reduce(
			(count, record) => count + (record.kind === "event" ? 0 : 1),
			0,
		);
	}

	private admitWaitingResponse(): void {
		if (
			this.closed ||
			this.responseCount() >= this.responseCapacity ||
			this.waitingResponse === undefined
		)
			return;
		const waiting = this.waitingResponse;
		this.waitingResponse = undefined;
		this.records.push(waiting.record);
		waiting.resolve(true);
	}

	private take(): Promise<IteratorResult<ServerRecord>> {
		const record = this.records.shift();
		if (record !== undefined) {
			this.admitWaitingResponse();
			return Promise.resolve({ value: record, done: false });
		}
		if (this.closed) return Promise.resolve({ value: undefined, done: true });
		return new Promise((resolve) => this.readers.push(resolve));
	}

	[Symbol.asyncIterator](): AsyncIterator<ServerRecord> {
		return { next: () => this.take() };
	}
}

export const makeSessionProtocol = (
	options: SessionProtocolOptions,
): SessionProtocol => {
	const limits = options.limits ?? defaultProtocolLimits;
	const output = new ProtocolOutput(
		limits.maxPendingRequests,
		limits.maxBufferedEvents,
	);
	const requests = new AsyncQueue<QueuedRequest>({
		capacity: limits.maxPendingRequests,
		overflow: "reject",
	});
	let closed = false;

	const success = async (
		request: ClientRequest,
		data: unknown,
	): Promise<SuccessResponse> =>
		makeSuccess({
			request,
			lastSequence: await options.runtime.lastEventSequence(),
			data,
		});
	const handleRequest = async (
		request: ClientRequest,
	): Promise<ResponseRecord> => {
		switch (request.method) {
			case "ping":
				return makeSuccess({ request, data: { pong: true } });
			case "session.start":
				await options.runtime.start();
				return success(request, { started: true });
			case "session.shutdown": {
				const accepted = await (options.shutdown ?? options.runtime.shutdown)();
				return success(request, { accepted });
			}
			case "session.snapshot":
				return success(request, await options.runtime.state());
			case "scheduler.snapshot":
				return success(request, await options.runtime.schedulerSnapshot());
			case "work.list": {
				const snapshot = await options.runtime.schedulerSnapshot();
				return success(request, { work: snapshot.work });
			}
			case "work.get": {
				const params = decodeWorkGetParams(request.params);
				const snapshot = await options.runtime.schedulerSnapshot();
				const work = snapshot.work.find(
					(candidate) => candidate.workKey === params.workKey,
				);
				return success(request, { work });
			}
			case "attempt.list": {
				const snapshot = await options.runtime.schedulerSnapshot();
				return success(request, { attempts: snapshot.running });
			}
			case "session.tick": {
				const result = await options.runtime.tickOnce();
				return success(request, { result });
			}
			case "session.dispatch.pause":
				await options.runtime.pauseDispatch();
				return success(request, { paused: true });
			case "session.dispatch.resume":
				await options.runtime.resumeDispatch();
				return success(request, { resumed: true });
			case "operator.observe": {
				const params = decodeObservationParams(request.params);
				const accepted =
					await options.runtime.recordOperatorObservation(params);
				return success(request, { accepted });
			}
			case "agent.interrupt": {
				const params = decodeInterruptParams(request.params);
				const accepted = await options.runtime.interruptAgentRun(params);
				return success(request, { accepted });
			}
		}
	};

	const eventPump = startOwnedTask({
		name: "session.protocol.events",
		run: async (signal) => {
			for await (const event of options.runtime.events(signal))
				output.offerEvent({
					protocol: sessionProtocolVersion,
					kind: "event",
					event,
				});
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
				let resolveAbort!: () => void;
				const onAbort = () => resolveAbort();
				const aborted = new Promise<void>((resolve) => {
					resolveAbort = resolve;
					if (signal.aborted) resolve();
					else signal.addEventListener("abort", onAbort, { once: true });
				});
				const handled = handleRequest(queued.request)
					.catch((error) => toErrorResponse(queued.request, error))
					.then((record) => ({ type: "record" as const, record }));
				// eslint-disable-next-line no-await-in-loop -- each response belongs to the current queued request.
				const result = await Promise.race([
					handled,
					aborted.then(() => ({ type: "aborted" as const })),
				]);
				signal.removeEventListener("abort", onAbort);
				if (result.type === "aborted") {
					queued.resolve(false);
					return;
				}
				// eslint-disable-next-line no-await-in-loop -- response backpressure bounds the protocol output.
				const published = await output.offerResponse(result.record, true);
				queued.resolve(
					published && result.record.kind === "response" && result.record.ok,
				);
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
				if (requests.offer({ request, resolve })) return;
				void output
					.offerResponse(
						makeError({
							request,
							code: "request_queue_full",
							message: "protocol request queue is full",
						}),
					)
					.then(() => resolve(false));
			});
		},
		output: () => output,
		close: async () => {
			if (closed) return;
			closed = true;
			for (const queued of requests.drain()) queued.resolve(false);
			requests.close();
			for (const task of tasks) task.stop();
			try {
				await done;
			} finally {
				output.close();
			}
		},
		done,
	};
};
