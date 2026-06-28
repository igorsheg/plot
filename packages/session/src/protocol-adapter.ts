import { AsyncQueue } from "@plot/common/async-queue";
import { z } from "zod";
import { errorMessage } from "./primitives.js";
import {
	ProtocolBoundaryError,
	defaultProtocolLimits,
	makeError,
	makeSuccess,
	makeWelcome,
	type ClientRequest,
	type ProtocolLimits,
	type ServerRecord,
} from "./protocol.js";
import {
	startOwnedTask,
	type OwnedTask,
	type SessionRuntime,
} from "./runtime.js";

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

const emptyParamsSchema = z.object({}).strict();
const interruptParamsSchema = z
	.object({
		runId: z.string().min(1),
		workKey: z.string().min(1).optional(),
	})
	.strict();

const decodeParams = <A>(schema: z.ZodType<A>, value: unknown): A => {
	try {
		return schema.parse(value ?? {});
	} catch (error) {
		throw new ProtocolBoundaryError({
			code: "invalid_request",
			message: errorMessage(error),
		});
	}
};

const toErrorResponse = (
	request: ClientRequest,
	error: unknown,
): ServerRecord => {
	if (error instanceof ProtocolBoundaryError)
		return makeError({
			request,
			code: error.code,
			message: error.message,
			...(error.details === undefined ? {} : { details: error.details }),
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
				decodeParams(emptyParamsSchema, request.params);
				return makeSuccess({ request, data: { pong: true } });
			case "start":
				decodeParams(emptyParamsSchema, request.params);
				await options.runtime.start();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { started: true },
				});
			case "shutdown":
				decodeParams(emptyParamsSchema, request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { accepted: await options.runtime.shutdown() },
				});
			case "get_state":
				decodeParams(emptyParamsSchema, request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { sessionId: options.runtime.id },
				});
			case "get_snapshot":
				decodeParams(emptyParamsSchema, request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						snapshot: await options.runtime.snapshot(),
						lastSequence: await options.runtime.lastEventSequence(),
					},
				});
			case "request_tick":
				decodeParams(emptyParamsSchema, request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { result: await options.runtime.tickOnce() },
				});
			case "pause_dispatch":
				decodeParams(emptyParamsSchema, request.params);
				await options.runtime.pauseDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { paused: true },
				});
			case "resume_dispatch":
				decodeParams(emptyParamsSchema, request.params);
				await options.runtime.resumeDispatch();
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: { resumed: true },
				});
			case "interrupt_agent_run": {
				const params = decodeParams(interruptParamsSchema, request.params);
				return makeSuccess({
					request,
					lastSequence: await options.runtime.lastEventSequence(),
					data: {
						accepted: await options.runtime.interruptAgentRun({
							runId: params.runId,
							...(params.workKey === undefined
								? {}
								: { workKey: params.workKey }),
						}),
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
					protocol: "plot.session.v2",
					kind: "event",
					sequence: event.sequence,
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
					// eslint-disable-next-line no-await-in-loop -- request pump owns one queued request at a time.
					queued = await requests.take();
				} catch {
					return;
				}
				// eslint-disable-next-line no-await-in-loop -- protocol responses must preserve request order.
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
