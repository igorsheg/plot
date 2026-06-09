import {
	Context,
	Deferred,
	Effect,
	Layer,
	PubSub,
	Queue,
	Schema,
	Scope,
	Stream,
	type Exit,
} from "effect";
import { withWideEvent } from "@plot/common/observability";
import { PlotSession, type PlotSessionShape } from "./plot-session.js";
import {
	type PlotClientRecord,
	type PlotCommand,
	type PlotEventRecord,
	PlotHelloRecord,
	type PlotProtocolEpoch,
	PlotProtocolFailure,
	type PlotProtocolLimits,
	type PlotProtocolSequence,
	type PlotServerRecord,
	SubscribeParams,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	makePlotEventRecord,
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
			const waitForSessionFrontier = Effect.gen(function* () {
				const frontier = yield* currentSessionSequence(session);
				yield* replay.waitUntil(frontier);
				return frontier;
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
						const lastEventSeq = yield* currentSessionSequence(session);
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
						const lastEventSeq = yield* currentSessionSequence(session);
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
					case "submit_observation":
						return yield* new PlotProtocolFailure({
							code: "invalid_request",
							message: "submit_observation is not implemented yet",
						});
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
				Stream.runForEach((event) => {
					const record: PlotEventRecord = makePlotEventRecord(epoch, event);
					return replay
						.append(record)
						.pipe(Effect.andThen(publishOutput(record)));
				}),
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
