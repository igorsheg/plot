import { AsyncQueue } from "@plot/common/async-queue";
import { EventHub } from "@plot/common/event-stream";
import { withWideEvent } from "@plot/common/observability";
import {
	safeParseAuthLoginParams,
	safeParseAuthProviderParams,
	safeParseAuthStatusParams,
	safeParseSubmitObservationParams,
	safeParseSubscribeParams,
} from "@plot/control/protocol";
import type { PlotSessionShape } from "./plot-session.js";
import { plotSessionEventSequence } from "./plot-session.js";
import type { PlotAuthShape } from "./pi-auth.js";
import {
	defaultPlotProtocolLimits,
	formatProtocolParseIssues,
	makePlotErrorResponse,
	makePlotSuccessResponse,
	PlotErrorResponseRecord,
	PlotEventRecord,
	PlotHelloRecord,
	PlotProtocolFailure,
	plotProtocolEpoch,
	plotProtocolSequence,
	type AuthLoginParams,
	type AuthProviderParams,
	type AuthStatusParams,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolEpoch,
	type PlotProtocolLimits,
	type PlotProtocolSequence,
	type PlotServerRecord,
	type SubmitObservationParams,
	type SubscribeParams,
} from "./protocol.js";
import { makePlotProtocolReplayBuffer } from "./protocol-replay-buffer.js";

export interface PlotProtocolLayerOptions {
	readonly epoch?: PlotProtocolEpoch;
	readonly limits?: PlotProtocolLimits;
	readonly capabilities?: readonly string[];
	readonly outputCapacity?: number;
	readonly auth?: PlotAuthShape;
	readonly session?: PlotSessionShape;
}
export interface PlotProtocolShape {
	readonly hello: () => Promise<PlotHelloRecord>;
	readonly submit: (request: PlotClientRecord) => Promise<boolean>;
	readonly output: () => AsyncIterable<PlotServerRecord>;
}
interface QueuedProtocolRequest {
	readonly request: PlotClientRecord;
	readonly resolve: (value: boolean) => void;
}
export type PlotProtocol = PlotProtocolShape;
export const PlotProtocol = Symbol("PlotProtocol");
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const invalidParams = (
	issues: Parameters<typeof formatProtocolParseIssues>[0],
) =>
	new PlotProtocolFailure({
		code: "invalid_request",
		message: formatProtocolParseIssues(issues),
	});
const decodeSubscribeParams = (value: unknown): SubscribeParams => {
	const parsed = safeParseSubscribeParams(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data as SubscribeParams;
};
const decodeSubmitObservationParams = (
	value: unknown,
): SubmitObservationParams => {
	const parsed = safeParseSubmitObservationParams(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data as SubmitObservationParams;
};
const decodeAuthProviderParams = (value: unknown): AuthProviderParams => {
	const parsed = safeParseAuthProviderParams(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data as AuthProviderParams;
};
const decodeAuthStatusParams = (value: unknown): AuthStatusParams => {
	const parsed = safeParseAuthStatusParams(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data as AuthStatusParams;
};
const decodeAuthLoginParams = (value: unknown): AuthLoginParams => {
	const parsed = safeParseAuthLoginParams(value);
	if (!parsed.success) throw invalidParams(parsed.error.issues);
	return parsed.data as AuthLoginParams;
};
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const checkObservationPayloadLimit = (
	params: SubmitObservationParams,
	limits: PlotProtocolLimits,
) => {
	const bytes = byteLength(JSON.stringify(params.observation));
	if (bytes > limits.maxObservationPayloadBytes)
		throw new PlotProtocolFailure({
			code: "payload_too_large",
			message: "observation exceeds maxObservationPayloadBytes",
			details: {
				maxObservationPayloadBytes: limits.maxObservationPayloadBytes,
				actualBytes: bytes,
			},
		});
};
const currentSessionSequence = async (session: PlotSessionShape) =>
	plotProtocolSequence(Number(await session.lastEventSequence()));
const makeSuccessForRequest = (params: {
	readonly request: PlotClientRecord;
	readonly lastEventSeq: PlotProtocolSequence;
	readonly data?: unknown;
}) =>
	makePlotSuccessResponse({
		id: params.request.id,
		command: params.request.command,
		lastEventSeq: params.lastEventSeq,
		...(params.data === undefined ? {} : { data: params.data }),
	});
const makeFailureForRequest = (
	request: PlotClientRecord,
	error: PlotProtocolFailure,
	lastEventSeq?: PlotProtocolSequence,
) =>
	makePlotErrorResponse({
		id: request.id,
		command: request.command,
		code: error.code,
		message: error.message,
		...(lastEventSeq === undefined ? {} : { lastEventSeq }),
		...(error.details === undefined ? {} : { details: error.details }),
	});
export const makePlotProtocolLayer = (
	options: PlotProtocolLayerOptions = {},
): PlotProtocolShape => {
	if (!options.session) throw new Error("PlotProtocol requires session");
	const session = options.session;
	const epoch = options.epoch ?? plotProtocolEpoch("default");
	const limits = options.limits ?? defaultPlotProtocolLimits;
	const capabilities = options.capabilities ?? ["stdio_jsonl"];
	const output = new EventHub<PlotServerRecord>(
		options.outputCapacity ?? limits.maxPendingRequests,
	);
	const requests = new AsyncQueue<QueuedProtocolRequest>({
		capacity: limits.maxPendingRequests,
	});
	let sequence = 0;
	let lastSessionSequence = 0;
	const replayPromise = makePlotProtocolReplayBuffer(limits);
	const publishOutput = (record: PlotServerRecord) => output.publish(record);
	const nextProtocolSequence = () => plotSessionEventSequence(++sequence);
	const appendAndPublishEvent = async (event: unknown) => {
		const replay = await replayPromise;
		const record = new PlotEventRecord({
			sessionId: session.id,
			epoch,
			sequence: nextProtocolSequence(),
			event,
		});
		await replay.append(record);
		publishOutput(record);
	};
	const publishAuthEvent = (type: string, payload: unknown) =>
		appendAndPublishEvent({ type, source: "plot_auth", payload });
	const waitForSessionFrontier = async () => {
		const target = Number(await currentSessionSequence(session));
		while (true) {
			if (lastSessionSequence >= target)
				return (await replayPromise).lastSequence();
			await Promise.resolve();
		}
	};
	const mapUnknownError = (error: unknown) =>
		error instanceof PlotProtocolFailure
			? error
			: new PlotProtocolFailure({
					code: "internal_error",
					message: errorMessage(error),
				});
	const handleRequest = async (
		request: PlotClientRecord,
	): Promise<readonly PlotServerRecord[]> => {
		switch (request.command as PlotCommand) {
			case "ping":
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { pong: true },
					}),
				];
			case "start":
				await session.start();
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await waitForSessionFrontier(),
					}),
				];
			case "tick_once": {
				const result = await session.tickOnce();
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await waitForSessionFrontier(),
						data: { result },
					}),
				];
			}
			case "get_snapshot":
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: {
							snapshot: await session.snapshot(),
							asOfSequence: await (await replayPromise).lastSequence(),
						},
					}),
				];
			case "subscribe": {
				const params = decodeSubscribeParams(request.params);
				const replay = await replayPromise;
				const afterSequence =
					params.afterSequence ?? (await replay.lastSequence());
				const replayed = await replay.replayAfter(afterSequence);
				return [
					...replayed,
					makeSuccessForRequest({
						request,
						lastEventSeq: await replay.lastSequence(),
						data: { replayed: replayed.length },
					}),
				];
			}
			case "shutdown":
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await waitForSessionFrontier(),
						data: { accepted: await session.shutdown() },
					}),
				];
			case "auth_providers": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { providers: await options.auth.providers() },
					}),
				];
			}
			case "auth_status": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthStatusParams(request.params);
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { status: await options.auth.status(params.provider) },
					}),
				];
			}
			case "auth_login": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthLoginParams(request.params);
				await publishAuthEvent("auth_login_started", {
					provider: params.provider,
				});
				try {
					await options.auth.login({
						provider: params.provider,
						...(params.promptResponses === undefined
							? {}
							: { promptResponses: params.promptResponses }),
						...(params.selectResponse === undefined
							? {}
							: { selectResponse: params.selectResponse }),
						...(params.manualCode === undefined
							? {}
							: { manualCode: params.manualCode }),
						events: {
							auth: (info) => {
								void publishAuthEvent("auth_open_url", info);
							},
							deviceCode: (info) => {
								void publishAuthEvent("auth_device_code", info);
							},
							prompt: (prompt) => {
								void publishAuthEvent("auth_prompt", prompt);
							},
							select: (prompt) => {
								void publishAuthEvent("auth_select", prompt);
							},
							progress: (message) => {
								void publishAuthEvent("auth_progress", { message });
							},
						},
					});
				} catch (error) {
					const message = errorMessage(error);
					if (message.includes("requires prompt input"))
						throw new PlotProtocolFailure({
							code: "auth_input_required",
							message,
						});
					throw mapUnknownError(error);
				}
				await publishAuthEvent("auth_login_succeeded", {
					provider: params.provider,
				});
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { provider: params.provider, loggedIn: true },
					}),
				];
			}
			case "auth_logout": {
				if (!options.auth)
					throw new PlotProtocolFailure({
						code: "auth_unavailable",
						message: "auth service is not configured",
					});
				const params = decodeAuthProviderParams(request.params);
				await options.auth.logout(params.provider);
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { provider: params.provider, loggedOut: true },
					}),
				];
			}
			case "submit_observation": {
				const params = decodeSubmitObservationParams(request.params);
				checkObservationPayloadLimit(params, limits);
				const accepted = await session.submitObservation(params.observation);
				if (!accepted)
					throw new PlotProtocolFailure({
						code: "internal_error",
						message: "observation was not accepted by the Plot loop mailbox",
					});
				return [
					makeSuccessForRequest({
						request,
						lastEventSeq: await (await replayPromise).lastSequence(),
						data: { accepted },
					}),
				];
			}
		}
	};
	const processRequest = async (request: PlotClientRecord) => {
		const lastBefore = await (await replayPromise).lastSequence();
		const records = await handleRequest(request).catch((error) => [
			makeFailureForRequest(request, mapUnknownError(error), lastBefore),
		]);
		for (const record of records) publishOutput(record);
	};
	void (async () => {
		for await (const event of session.events()) {
			await appendAndPublishEvent(event);
			lastSessionSequence = Number(event.sequence);
		}
	})();
	void (async () => {
		while (true) {
			const queued = await requests.take();
			await processRequest(queued.request);
			queued.resolve(true);
		}
	})();
	return {
		hello: async () =>
			withWideEvent("plot_protocol.hello", { epoch }, async () => {
				const snapshot = await (await replayPromise).snapshot();
				return new PlotHelloRecord({
					sessionId: session.id,
					epoch,
					firstEventSeq: snapshot.firstEventSeq,
					lastEventSeq: snapshot.lastEventSeq,
					capabilities: [...capabilities],
					limits,
				});
			}),
		submit: async (request) =>
			withWideEvent(
				"plot_protocol.submit",
				{ request_id: request.id, command: request.command },
				async () =>
					new Promise<boolean>((resolve) => {
						if (!requests.offer({ request, resolve })) {
							void (async () =>
								publishOutput(
									new PlotErrorResponseRecord({
										id: request.id,
										command: request.command,
										lastEventSeq: await (await replayPromise).lastSequence(),
										error: {
											code: "request_queue_full",
											message: "protocol request queue is full",
										},
									}),
								))();
							resolve(false);
						}
					}),
			),
		output: () => output.subscribe(),
	};
};
