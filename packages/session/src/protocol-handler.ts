import {
	Context,
	Deferred,
	Effect,
	Layer,
	PubSub,
	Queue,
	Ref,
	Schema,
	Scope,
	Stream,
	type Exit,
} from "effect";
import { withWideEvent } from "@plot/common/observability";
import {
	PlotSession,
	plotSessionEventSequence,
	type PlotSessionShape,
} from "./plot-session.js";
import type { PlotAuthShape } from "./pi-auth.js";
import {
	AuthLoginParams,
	AuthProviderParams,
	AuthStatusParams,
	type PlotClientRecord,
	type PlotCommand,
	PlotEventRecord,
	PlotHelloRecord,
	type PlotProtocolEpoch,
	PlotProtocolFailure,
	type PlotProtocolLimits,
	type PlotProtocolSequence,
	type PlotServerRecord,
	SubmitObservationParams,
	SubscribeParams,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	makePlotSuccessResponse,
	plotProtocolEpoch,
	plotProtocolSequence,
} from "./protocol.js";
import { makePlotProtocolReplayBuffer } from "./protocol-replay-buffer.js";

export interface PlotProtocolLayerOptions {
	readonly epoch?: PlotProtocolEpoch;
	readonly limits?: PlotProtocolLimits;
	readonly capabilities?: readonly string[];
	readonly outputCapacity?: number;
	readonly auth?: PlotAuthShape;
}

export interface PlotProtocolShape {
	readonly hello: () => Effect.Effect<PlotHelloRecord>;
	readonly submit: (request: PlotClientRecord) => Effect.Effect<boolean, never>;
	readonly output: () => Stream.Stream<PlotServerRecord>;
}

interface QueuedProtocolRequest {
	readonly request: PlotClientRecord;
	readonly completed: Deferred.Deferred<boolean>;
}

export class PlotProtocol extends Context.Service<
	PlotProtocol,
	PlotProtocolShape
>()("@plot/session/PlotProtocol") {}

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const decodeSubscribeParams = (
	value: unknown,
): Effect.Effect<SubscribeParams, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(SubscribeParams)(value ?? {}).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

const byteLength = (value: string) => new TextEncoder().encode(value).length;

const observationPayloadBytes = (value: unknown) =>
	Effect.try({
		try: () => byteLength(JSON.stringify(value)),
		catch: (error) =>
			new PlotProtocolFailure({
				code: "invalid_request",
				message: errorMessage(error),
			}),
	});

const decodeSubmitObservationParams = (
	value: unknown,
): Effect.Effect<SubmitObservationParams, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(SubmitObservationParams)(value ?? {}).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

const checkObservationPayloadLimit = (
	params: SubmitObservationParams,
	limits: PlotProtocolLimits,
) =>
	observationPayloadBytes(params.observation).pipe(
		Effect.flatMap((bytes) =>
			bytes <= limits.maxObservationPayloadBytes
				? Effect.void
				: new PlotProtocolFailure({
						code: "payload_too_large",
						message: "observation exceeds maxObservationPayloadBytes",
						details: {
							maxObservationPayloadBytes: limits.maxObservationPayloadBytes,
							actualBytes: bytes,
						},
					}),
		),
	);

const decodeAuthProviderParams = (
	value: unknown,
): Effect.Effect<AuthProviderParams, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(AuthProviderParams)(value ?? {}).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

const decodeAuthStatusParams = (
	value: unknown,
): Effect.Effect<AuthStatusParams, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(AuthStatusParams)(value ?? {}).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

const decodeAuthLoginParams = (
	value: unknown,
): Effect.Effect<AuthLoginParams, PlotProtocolFailure> =>
	Schema.decodeUnknownEffect(AuthLoginParams)(value ?? {}).pipe(
		Effect.mapError(
			(error) =>
				new PlotProtocolFailure({
					code: "invalid_request",
					message: error.message,
				}),
		),
	);

const publish =
	(pubsub: PubSub.PubSub<PlotServerRecord>) => (record: PlotServerRecord) =>
		PubSub.publish(pubsub, record).pipe(Effect.asVoid);

const currentSessionSequence = (session: PlotSessionShape) =>
	session
		.lastEventSequence()
		.pipe(Effect.map((sequence) => plotProtocolSequence(Number(sequence))));

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
): Layer.Layer<PlotProtocol, never, PlotSession> => {
	const epoch = options.epoch ?? plotProtocolEpoch("default");
	const limits = options.limits ?? defaultPlotProtocolLimits;
	const capabilities = options.capabilities ?? ["stdio_jsonl"];
	const outputCapacity = options.outputCapacity ?? limits.maxPendingRequests;

	return Layer.effect(
		PlotProtocol,
		Effect.gen(function* () {
			const session = yield* PlotSession;
			const output = yield* PubSub.sliding<PlotServerRecord>(outputCapacity);
			const requests = yield* Queue.dropping<QueuedProtocolRequest>(
				limits.maxPendingRequests,
			);
			const replay = yield* makePlotProtocolReplayBuffer(limits);
			const protocolScope = yield* Scope.make();
			yield* Effect.addFinalizer((exit: Exit.Exit<unknown, unknown>) =>
				Effect.all([
					Queue.shutdown(requests).pipe(Effect.asVoid),
					PubSub.shutdown(output),
					Scope.close(protocolScope, exit),
				]).pipe(Effect.asVoid),
			);

			const publishOutput = publish(output);
			const sequenceRef = yield* Ref.make(0);
			const lastSessionSequenceRef = yield* Ref.make(0);
			const nextProtocolSequence = Ref.updateAndGet(
				sequenceRef,
				(sequence) => sequence + 1,
			).pipe(Effect.map(plotSessionEventSequence));
			const appendAndPublishEvent = (event: unknown) =>
				Effect.gen(function* () {
					const sequence = yield* nextProtocolSequence;
					const record = new PlotEventRecord({
						protocol: "plot.v1",
						kind: "event",
						sessionId: session.id,
						epoch,
						sequence,
						event,
					});
					yield* replay.append(record);
					yield* publishOutput(record);
				});
			const publishAuthEvent = (type: string, payload: unknown) =>
				appendAndPublishEvent({
					type,
					source: "plot_auth",
					payload,
				});
			const waitForSessionFrontier = Effect.gen(function* () {
				const frontier = yield* currentSessionSequence(session);
				const target = Number(frontier);
				while (true) {
					const seen = yield* Ref.get(lastSessionSequenceRef);
					if (seen >= target) break;
					yield* Effect.yieldNow;
				}
				return yield* replay.lastSequence();
			});
			const mapUnknownError = (error: unknown) => {
				if (error instanceof PlotProtocolFailure) return error;
				return new PlotProtocolFailure({
					code: "internal_error",
					message: errorMessage(error),
				});
			};

			const handleRequest = Effect.fn("PlotProtocol.handleRequest")(function* (
				request: PlotClientRecord,
			) {
				const command: PlotCommand = request.command;
				switch (command) {
					case "ping": {
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { pong: true },
							}),
						];
					}
					case "start": {
						yield* session.start().pipe(Effect.mapError(mapUnknownError));
						const lastEventSeq = yield* waitForSessionFrontier;
						return [makeSuccessForRequest({ request, lastEventSeq })];
					}
					case "tick_once": {
						const result = yield* session
							.tickOnce()
							.pipe(Effect.mapError(mapUnknownError));
						const lastEventSeq = yield* waitForSessionFrontier;
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { result },
							}),
						];
					}
					case "get_snapshot": {
						const snapshot = yield* session
							.snapshot()
							.pipe(Effect.mapError(mapUnknownError));
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { snapshot, asOfSequence: lastEventSeq },
							}),
						];
					}
					case "subscribe": {
						const params = yield* decodeSubscribeParams(request.params);
						const afterSequence =
							params.afterSequence ?? (yield* replay.lastSequence());
						const replayed = yield* replay.replayAfter(afterSequence);
						const lastEventSeq = yield* replay.lastSequence();
						return [
							...replayed,
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { replayed: replayed.length },
							}),
						];
					}
					case "shutdown": {
						const accepted = yield* session
							.shutdown()
							.pipe(Effect.mapError(mapUnknownError));
						const lastEventSeq = yield* waitForSessionFrontier;
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { accepted },
							}),
						];
					}
					case "auth_providers": {
						if (options.auth === undefined) {
							return yield* new PlotProtocolFailure({
								code: "auth_unavailable",
								message: "auth service is not configured",
							});
						}
						const providers = yield* Effect.tryPromise({
							try: () => options.auth?.providers() ?? Promise.resolve([]),
							catch: mapUnknownError,
						});
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { providers },
							}),
						];
					}
					case "auth_status": {
						if (options.auth === undefined) {
							return yield* new PlotProtocolFailure({
								code: "auth_unavailable",
								message: "auth service is not configured",
							});
						}
						const params = yield* decodeAuthStatusParams(request.params);
						const status = yield* Effect.tryPromise({
							try: () =>
								options.auth?.status(params.provider) ?? Promise.resolve([]),
							catch: mapUnknownError,
						});
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { status },
							}),
						];
					}
					case "auth_login": {
						if (options.auth === undefined) {
							return yield* new PlotProtocolFailure({
								code: "auth_unavailable",
								message: "auth service is not configured",
							});
						}
						const params = yield* decodeAuthLoginParams(request.params);
						yield* publishAuthEvent("auth_login_started", {
							provider: params.provider,
						});
						yield* Effect.tryPromise({
							try: () =>
								options.auth?.login({
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
										auth: (info) =>
											Effect.runSync(publishAuthEvent("auth_open_url", info)),
										deviceCode: (info) =>
											Effect.runSync(
												publishAuthEvent("auth_device_code", info),
											),
										prompt: (prompt) =>
											Effect.runSync(publishAuthEvent("auth_prompt", prompt)),
										select: (prompt) =>
											Effect.runSync(publishAuthEvent("auth_select", prompt)),
										progress: (message) =>
											Effect.runSync(
												publishAuthEvent("auth_progress", { message }),
											),
									},
								}) ?? Promise.resolve(),
							catch: (error) => {
								const message = errorMessage(error);
								if (message.includes("requires prompt input")) {
									return new PlotProtocolFailure({
										code: "auth_input_required",
										message,
									});
								}
								return mapUnknownError(error);
							},
						});
						yield* publishAuthEvent("auth_login_succeeded", {
							provider: params.provider,
						});
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { provider: params.provider, loggedIn: true },
							}),
						];
					}
					case "auth_logout": {
						if (options.auth === undefined) {
							return yield* new PlotProtocolFailure({
								code: "auth_unavailable",
								message: "auth service is not configured",
							});
						}
						const params = yield* decodeAuthProviderParams(request.params);
						yield* Effect.tryPromise({
							try: () =>
								options.auth?.logout(params.provider) ?? Promise.resolve(),
							catch: mapUnknownError,
						});
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { provider: params.provider, loggedOut: true },
							}),
						];
					}
					case "submit_observation": {
						const params = yield* decodeSubmitObservationParams(request.params);
						yield* checkObservationPayloadLimit(params, limits);
						const accepted = yield* session
							.submitObservation(params.observation)
							.pipe(Effect.mapError(mapUnknownError));
						if (!accepted) {
							return yield* new PlotProtocolFailure({
								code: "internal_error",
								message:
									"observation was not accepted by the Plot loop mailbox",
							});
						}
						const lastEventSeq = yield* replay.lastSequence();
						return [
							makeSuccessForRequest({
								request,
								lastEventSeq,
								data: { accepted },
							}),
						];
					}
				}
			});

			const processRequest = Effect.fn("PlotProtocol.processRequest")(
				function* (request: PlotClientRecord) {
					const lastBefore = yield* replay.lastSequence();
					const records = yield* handleRequest(request).pipe(
						Effect.catch((error) =>
							Effect.succeed([
								makeFailureForRequest(request, error, lastBefore),
							]),
						),
					);
					for (const record of records) {
						yield* publishOutput(record);
					}
				},
			);

			yield* session.events().pipe(
				Stream.runForEach((event) =>
					appendAndPublishEvent(event).pipe(
						Effect.andThen(
							Ref.set(lastSessionSequenceRef, Number(event.sequence)),
						),
					),
				),
				Effect.forkIn(protocolScope, { startImmediately: true }),
				Effect.asVoid,
			);

			yield* Effect.gen(function* () {
				while (true) {
					const queued = yield* Queue.take(requests);
					yield* processRequest(queued.request);
					yield* Deferred.succeed(queued.completed, true);
				}
			}).pipe(
				Effect.forkIn(protocolScope, { startImmediately: true }),
				Effect.asVoid,
			);

			const hello = Effect.fn("PlotProtocol.hello")(function* () {
				return yield* withWideEvent(
					"plot_protocol.hello",
					{ epoch },
					Effect.gen(function* () {
						const snapshot = yield* replay.snapshot();
						return new PlotHelloRecord({
							protocol: "plot.v1",
							kind: "hello",
							sessionId: session.id,
							epoch,
							firstEventSeq: snapshot.firstEventSeq,
							lastEventSeq: snapshot.lastEventSeq,
							capabilities: [...capabilities],
							limits,
						});
					}),
				);
			});

			const submit = Effect.fn("PlotProtocol.submit")(function* (
				request: PlotClientRecord,
			) {
				return yield* withWideEvent(
					"plot_protocol.submit",
					{ request_id: request.id, command: request.command },
					Effect.gen(function* () {
						const completed = yield* Deferred.make<boolean>();
						const accepted = yield* Queue.offer(requests, {
							request,
							completed,
						});
						if (!accepted) {
							const lastEventSeq = yield* replay.lastSequence();
							yield* publishOutput(
								makePlotErrorResponse({
									id: request.id,
									command: request.command,
									lastEventSeq,
									code: "request_queue_full",
									message: "protocol request queue is full",
								}),
							);
							return false;
						}
						return yield* Deferred.await(completed);
					}),
				);
			});

			return {
				hello,
				submit,
				output: () => Stream.fromPubSub(output),
			} satisfies PlotProtocolShape;
		}),
	);
};
