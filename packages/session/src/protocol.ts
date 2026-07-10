import { AsyncQueue } from "@plot/common/async-queue";
import {
	JsonlBoundaryError,
	parseJsonl,
	stringifyJsonl,
} from "@plot/common/jsonl";
import { byteLength, errorMessage, isRecord } from "@plot/common/primitives";
import type {
	OperatorObservationInput,
	RuntimeEvent,
	SessionRuntime,
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
	readonly lastSequence?: number | undefined;
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
	readonly id?: string | undefined;
	readonly method?: SessionProtocolMethod | undefined;
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
		this.details = input.details;
	}
}

const invalid = (message: string): never => {
	throw new ProtocolBoundaryError({ code: "invalid_request", message });
};

const object = (value: unknown, message: string): Record<string, unknown> =>
	isRecord(value) ? value : invalid(message);

const string = (value: unknown, label: string): string =>
	typeof value === "string" && value.length > 0
		? value
		: invalid(`${label} must be a non-empty string`);

const method = (value: unknown): SessionProtocolMethod =>
	sessionProtocolMethods.find((candidate) => candidate === value) ??
	invalid(`unknown method: ${String(value)}`);

const assertVersion = (value: Record<string, unknown>): void => {
	if (value["protocol"] !== sessionProtocolVersion)
		invalid(
			`unsupported protocol ${JSON.stringify(value["protocol"])}; this build speaks ${sessionProtocolVersion} (a stale plot daemon or child may need a restart)`,
		);
};

export const decodeClientRequest = (value: unknown): ClientRequest => {
	const input = object(value, "request must be an object");
	assertVersion(input);
	if (input["kind"] !== "request")
		invalid(`unknown request kind: ${String(input["kind"])}`);
	const id = string(input["id"], "request id");
	if (id.length > 128)
		invalid("request id must be a non-empty string of at most 128 chars");
	return {
		protocol: sessionProtocolVersion,
		kind: "request",
		id,
		method: method(input["method"]),
		params: input["params"],
	};
};

const positiveInteger = (value: unknown, label: string): number => {
	const number =
		typeof value === "number"
			? value
			: invalid(`${label} must be a positive integer`);
	if (!Number.isInteger(number) || number < 1)
		invalid(`${label} must be a positive integer`);
	return number;
};

const decodeLimits = (value: unknown): ProtocolLimits => {
	const input = object(value, "protocol limits must be an object");
	return {
		maxInputLineBytes: positiveInteger(
			input["maxInputLineBytes"],
			"maxInputLineBytes",
		),
		maxOutputLineBytes: positiveInteger(
			input["maxOutputLineBytes"],
			"maxOutputLineBytes",
		),
		maxPendingRequests: positiveInteger(
			input["maxPendingRequests"],
			"maxPendingRequests",
		),
		maxBufferedEvents: positiveInteger(
			input["maxBufferedEvents"],
			"maxBufferedEvents",
		),
	};
};

const decodeRuntimeEvent = (value: unknown): RuntimeEvent => {
	const input = object(value, "event record requires an event object");
	if (input["kind"] !== "session_event" && input["kind"] !== "agent_event")
		invalid(`unknown runtime event kind: ${String(input["kind"])}`);
	const sequence = input["sequence"];
	if (
		typeof sequence !== "number" ||
		!Number.isInteger(sequence) ||
		sequence < 1
	)
		invalid("runtime event sequence must be a positive integer");
	string(input["sessionId"], "runtime event sessionId");
	string(input["timestamp"], "runtime event timestamp");
	object(input["event"], "runtime event payload must be an object");
	if (input["kind"] === "agent_event") {
		string(input["sourceId"], "agent event sourceId");
		string(input["runId"], "agent event runId");
		string(input["workKey"], "agent event workKey");
	}
	return input as unknown as RuntimeEvent;
};

const protocolErrorCodes = new Set<ProtocolErrorCode>([
	"parse_error",
	"invalid_request",
	"payload_too_large",
	"request_queue_full",
	"session_closed",
	"internal_error",
]);

export const decodeServerRecord = (value: unknown): ServerRecord => {
	const input = object(value, "server record must be an object");
	assertVersion(input);
	if (input["kind"] === "welcome")
		return {
			protocol: sessionProtocolVersion,
			kind: "welcome",
			sessionId: string(input["sessionId"], "sessionId"),
			limits: decodeLimits(input["limits"]),
		};
	if (input["kind"] === "event")
		return {
			protocol: sessionProtocolVersion,
			kind: "event",
			event: decodeRuntimeEvent(input["event"]),
		};
	if (input["kind"] !== "response")
		invalid(`unknown server record kind: ${String(input["kind"])}`);
	if (input["ok"] === true) {
		const lastSequence = input["lastSequence"];
		if (
			lastSequence !== undefined &&
			(typeof lastSequence !== "number" ||
				!Number.isInteger(lastSequence) ||
				lastSequence < 0)
		)
			invalid("lastSequence must be a non-negative integer");
		return {
			protocol: sessionProtocolVersion,
			kind: "response",
			id: string(input["id"], "response id"),
			method: method(input["method"]),
			ok: true,
			lastSequence: lastSequence as number | undefined,
			data: input["data"],
		};
	}
	if (input["ok"] !== false) invalid("response ok must be true or false");
	const error = object(
		input["error"],
		"error response requires an error object",
	);
	if (!protocolErrorCodes.has(error["code"] as ProtocolErrorCode))
		invalid(`unknown protocol error code: ${String(error["code"])}`);
	const responseMethod =
		input["method"] === undefined ? undefined : method(input["method"]);
	return {
		protocol: sessionProtocolVersion,
		kind: "response",
		id:
			input["id"] === undefined
				? undefined
				: string(input["id"], "response id"),
		method: responseMethod,
		ok: false,
		error: {
			code: error["code"] as ProtocolErrorCode,
			message: string(error["message"], "error message"),
			details: error["details"],
		},
	};
};

export const toProtocolBoundaryError = (
	error: unknown,
): ProtocolBoundaryError => {
	if (error instanceof ProtocolBoundaryError) return error;
	if (error instanceof JsonlBoundaryError)
		return new ProtocolBoundaryError({
			code: error.code === "parse_error" ? "parse_error" : "payload_too_large",
			message: error.message,
		});
	return new ProtocolBoundaryError({
		code: "invalid_request",
		message: errorMessage(error),
	});
};

const assertInputLineSize = (line: string, limits: ProtocolLimits): void => {
	const bytes = byteLength(line);
	if (bytes > limits.maxInputLineBytes)
		throw new ProtocolBoundaryError({
			code: "payload_too_large",
			message: "protocol input line exceeds maxInputLineBytes",
			details: { bytes, maxInputLineBytes: limits.maxInputLineBytes },
		});
};

const atProtocolBoundary = <A>(read: () => A): A => {
	try {
		return read();
	} catch (error) {
		throw toProtocolBoundaryError(error);
	}
};

export const encodeServerRecordLine = (
	record: ServerRecord,
	limits: ProtocolLimits = defaultProtocolLimits,
): string =>
	atProtocolBoundary(() =>
		stringifyJsonl(record, { maxLineBytes: limits.maxOutputLineBytes }),
	);

export const decodeClientRequestLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ClientRequest =>
	atProtocolBoundary(() => {
		assertInputLineSize(line, limits);
		return decodeClientRequest(parseJsonl(line));
	});

export const decodeServerRecordLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ServerRecord =>
	atProtocolBoundary(() => {
		assertInputLineSize(line, limits);
		return decodeServerRecord(parseJsonl(line));
	});

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
	readonly lastSequence?: number | undefined;
	readonly data?: unknown;
}): SuccessResponse => ({
	protocol: sessionProtocolVersion,
	kind: "response",
	id: input.request.id,
	method: input.request.method,
	ok: true,
	lastSequence: input.lastSequence,
	data: input.data,
});

export const makeError = (input: {
	readonly request?: ClientRequest | undefined;
	readonly code: ProtocolErrorCode;
	readonly message: string;
	readonly details?: unknown;
}): ErrorResponse => ({
	protocol: sessionProtocolVersion,
	kind: "response",
	id: input.request?.id,
	method: input.request?.method,
	ok: false,
	error: {
		code: input.code,
		message: input.message,
		details: input.details,
	},
});

const params = (value: unknown, operation: string) =>
	object(value, `${operation} requires params`);

const decodeInterruptParams = (
	value: unknown,
): { runId: string; workKey?: string } => {
	const input = params(value, "agent.interrupt");
	const result: { runId: string; workKey?: string } = {
		runId: string(input["runId"], "agent.interrupt runId"),
	};
	if (typeof input["workKey"] === "string" && input["workKey"].length > 0)
		result.workKey = input["workKey"];
	return result;
};

const decodeObservationParams = (value: unknown): OperatorObservationInput => {
	const input = params(value, "operator.observe");
	return {
		sourceId: string(input["sourceId"], "operator.observe sourceId"),
		workKey: string(input["workKey"], "operator.observe workKey"),
		actionId: string(input["actionId"], "operator.observe actionId"),
		actionLabel: string(input["actionLabel"], "operator.observe actionLabel"),
		comment:
			typeof input["comment"] === "string" ? input["comment"] : undefined,
		clientId:
			typeof input["clientId"] === "string" && input["clientId"].length > 0
				? input["clientId"]
				: undefined,
		actor:
			typeof input["actor"] === "string" && input["actor"].length > 0
				? input["actor"]
				: undefined,
	};
};

const decodeWorkGetParams = (value: unknown): { workKey: string } => {
	const input = params(value, "work.get");
	return { workKey: string(input["workKey"], "work.get workKey") };
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

type ResponseRecord = SuccessResponse | ErrorResponse;
interface QueuedRequest {
	readonly request: ClientRequest;
	readonly resolve: (accepted: boolean) => void;
}

const toErrorResponse = (
	request: ClientRequest,
	error: unknown,
): ErrorResponse =>
	error instanceof ProtocolBoundaryError
		? makeError({
				request,
				code: error.code,
				message: error.message,
				details: error.details,
			})
		: makeError({
				request,
				code: "internal_error",
				message: errorMessage(error),
			});

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
		const events = this.records
			.map((candidate, index) => ({ candidate, index }))
			.filter(({ candidate }) => candidate.kind === "event");
		if (events.length >= this.eventCapacity)
			this.records.splice(events[0]!.index, 1);
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
	const eventController = new AbortController();
	const requestController = new AbortController();
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
			case "session.shutdown":
				return success(request, {
					accepted: await (options.shutdown ?? options.runtime.shutdown)(),
				});
			case "session.snapshot":
				return success(request, await options.runtime.state());
			case "scheduler.snapshot":
				return success(request, await options.runtime.schedulerSnapshot());
			case "work.list":
				return success(request, {
					work: (await options.runtime.schedulerSnapshot()).work,
				});
			case "work.get": {
				const { workKey } = decodeWorkGetParams(request.params);
				const { work } = await options.runtime.schedulerSnapshot();
				return success(request, {
					work: work.find((candidate) => candidate.workKey === workKey),
				});
			}
			case "attempt.list":
				return success(request, {
					attempts: (await options.runtime.schedulerSnapshot()).running,
				});
			case "session.tick":
				return success(request, { result: await options.runtime.tickOnce() });
			case "session.dispatch.pause":
				await options.runtime.pauseDispatch();
				return success(request, { paused: true });
			case "session.dispatch.resume":
				await options.runtime.resumeDispatch();
				return success(request, { resumed: true });
			case "operator.observe":
				return success(request, {
					accepted: await options.runtime.recordOperatorObservation(
						decodeObservationParams(request.params),
					),
				});
			case "agent.interrupt":
				return success(request, {
					accepted: await options.runtime.interruptAgentRun(
						decodeInterruptParams(request.params),
					),
				});
		}
	};

	const eventPump = (async () => {
		for await (const event of options.runtime.events(eventController.signal))
			output.offerEvent({
				protocol: sessionProtocolVersion,
				kind: "event",
				event,
			});
	})();
	const requestPump = (async () => {
		for await (const queued of requests) {
			let onAbort!: () => void;
			const aborted = new Promise<"aborted">((resolve) => {
				onAbort = () => resolve("aborted");
				if (requestController.signal.aborted) onAbort();
				else
					requestController.signal.addEventListener("abort", onAbort, {
						once: true,
					});
			});
			const handled = handleRequest(queued.request)
				.catch((error) => toErrorResponse(queued.request, error))
				.then((response) => ({ response }));
			const result = await Promise.race([handled, aborted]);
			requestController.signal.removeEventListener("abort", onAbort);
			if (result === "aborted") {
				queued.resolve(false);
				return;
			}
			const published = await output.offerResponse(result.response, true);
			queued.resolve(published && result.response.ok);
		}
	})();
	const done = Promise.all([eventPump, requestPump]).then(() => undefined);

	return {
		welcome: async () => makeWelcome({ sessionId: options.runtime.id, limits }),
		submit: async (request) => {
			if (closed) return false;
			return new Promise<boolean>((resolve) => {
				if (requests.offer({ request, resolve })) return;
				void output.offerResponse(
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
			requests.drain().forEach((queued) => queued.resolve(false));
			requests.close();
			eventController.abort();
			requestController.abort();
			output.close();
			await done;
		},
		done,
	};
};
