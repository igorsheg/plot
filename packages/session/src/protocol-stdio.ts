import { Effect, Stream } from "effect";
import { logWideEvent } from "@plot/common/observability";
import { PlotProtocol } from "./protocol-handler.js";
import {
	PlotProtocolFailure,
	defaultPlotProtocolLimits,
	makePlotErrorResponse,
	type PlotProtocolLimits,
	type PlotServerRecord,
} from "./protocol.js";
import {
	flushJsonlDecoder,
	initialJsonlDecoderState,
	parsePlotClientJsonLine,
	serializePlotServerJsonLine,
	splitJsonlChunk,
	type JsonlDecoderState,
} from "./protocol-jsonl.js";

export type StdioChunk = string | Uint8Array;

export interface PlotProtocolStdioOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
	readonly limits?: PlotProtocolLimits;
	readonly emitHello?: boolean;
}

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const inputFailure = (error: unknown) =>
	new PlotProtocolFailure({
		code: "internal_error",
		message: errorMessage(error),
	});

const chunkDecoder = () => {
	const decoder = new TextDecoder();
	return {
		decode: (chunk: StdioChunk) =>
			typeof chunk === "string"
				? chunk
				: decoder.decode(chunk, { stream: true }),
		flush: () => decoder.decode(),
	};
};

const protocolFailureRecord = (error: PlotProtocolFailure) =>
	makePlotErrorResponse({
		code: error.code,
		message: error.message,
		...(error.details === undefined ? {} : { details: error.details }),
	});

export const runPlotProtocolStdio = (
	options: PlotProtocolStdioOptions,
): Effect.Effect<void, never, PlotProtocol> =>
	Effect.scoped(
		Effect.gen(function* () {
			const protocol = yield* PlotProtocol;
			const limits = options.limits ?? defaultPlotProtocolLimits;
			const decoder = chunkDecoder();
			let state: JsonlDecoderState = initialJsonlDecoderState;

			const writeRecord = (record: PlotServerRecord) =>
				serializePlotServerJsonLine(record, limits).pipe(
					Effect.catch((error) =>
						serializePlotServerJsonLine(protocolFailureRecord(error), limits),
					),
					Effect.flatMap(options.writeStdout),
					Effect.catch((error) =>
						logWideEvent(
							{
								operation: "plot_protocol.stdio.write_stdout",
								outcome: "error",
								error: errorMessage(error),
							},
							"error",
						),
					),
				);

			const writeFailure = (error: PlotProtocolFailure) =>
				writeRecord(protocolFailureRecord(error));

			const handleLine = (line: string) =>
				parsePlotClientJsonLine(line).pipe(
					Effect.flatMap(protocol.submit),
					Effect.catch(writeFailure),
					Effect.asVoid,
				);

			const processText = (text: string) =>
				splitJsonlChunk(state, text, limits).pipe(
					Effect.flatMap((result) =>
						Effect.gen(function* () {
							state = result.state;
							for (const line of result.lines) {
								yield* handleLine(line);
							}
						}),
					),
					Effect.catch((error) =>
						Effect.gen(function* () {
							state = initialJsonlDecoderState;
							yield* writeFailure(error);
						}),
					),
				);

			yield* protocol
				.output()
				.pipe(Stream.runForEach(writeRecord), Effect.forkScoped, Effect.asVoid);

			if (options.emitHello !== false) {
				yield* protocol.hello().pipe(Effect.flatMap(writeRecord));
			}

			yield* Stream.fromAsyncIterable(options.stdin, inputFailure).pipe(
				Stream.runForEach((chunk) => processText(decoder.decode(chunk))),
				Effect.catch(writeFailure),
			);

			const remainingText = decoder.flush();
			if (remainingText !== "") yield* processText(remainingText);
			const lines = yield* flushJsonlDecoder(state, limits).pipe(
				Effect.catch((error) =>
					writeFailure(error).pipe(Effect.as([] as readonly string[])),
				),
			);
			for (const line of lines) {
				yield* handleLine(line);
			}

			// Give the output subscriber a deterministic chance to drain records
			// published by the last accepted request before this scoped transport exits.
			yield* Effect.yieldNow;
		}),
	);
