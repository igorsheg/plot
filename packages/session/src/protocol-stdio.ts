import { logWideEvent } from "@plot/common/observability";
import type { PlotProtocolShape } from "./protocol-handler.js";
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
	readonly writeStdout: (line: string) => Promise<void> | void;
	readonly limits?: PlotProtocolLimits;
	readonly emitHello?: boolean;
	readonly protocol: PlotProtocolShape;
}
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
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
export const runPlotProtocolStdio = async (
	options: PlotProtocolStdioOptions,
): Promise<void> => {
	const protocol = options.protocol;
	const limits = options.limits ?? defaultPlotProtocolLimits;
	const decoder = chunkDecoder();
	let state: JsonlDecoderState = initialJsonlDecoderState;
	const writeRecord = async (record: PlotServerRecord) => {
		try {
			await options.writeStdout(
				await serializePlotServerJsonLine(record, limits),
			);
		} catch (error) {
			try {
				await options.writeStdout(
					await serializePlotServerJsonLine(
						protocolFailureRecord(
							error instanceof PlotProtocolFailure
								? error
								: new PlotProtocolFailure({
										code: "internal_error",
										message: errorMessage(error),
									}),
						),
						limits,
					),
				);
			} catch (writeError) {
				await logWideEvent(
					{
						operation: "plot_protocol.stdio.write_stdout",
						outcome: "error",
						error: errorMessage(writeError),
					},
					"error",
				);
			}
		}
	};
	const writeFailure = (error: PlotProtocolFailure) =>
		writeRecord(protocolFailureRecord(error));
	const handleLine = async (line: string) => {
		try {
			await protocol.submit(await parsePlotClientJsonLine(line));
		} catch (error) {
			await writeFailure(
				error instanceof PlotProtocolFailure
					? error
					: new PlotProtocolFailure({
							code: "internal_error",
							message: errorMessage(error),
						}),
			);
		}
	};
	const processText = async (text: string) => {
		try {
			const result = await splitJsonlChunk(state, text, limits);
			state = result.state;
			for (const line of result.lines) await handleLine(line);
		} catch (error) {
			state = initialJsonlDecoderState;
			await writeFailure(
				error instanceof PlotProtocolFailure
					? error
					: new PlotProtocolFailure({
							code: "internal_error",
							message: errorMessage(error),
						}),
			);
		}
	};
	void (async () => {
		for await (const record of protocol.output()) await writeRecord(record);
	})();
	if (options.emitHello !== false) await writeRecord(await protocol.welcome());
	for await (const chunk of options.stdin)
		await processText(decoder.decode(chunk));
	const remainingText = decoder.flush();
	if (remainingText !== "") await processText(remainingText);
	let lines: readonly string[] = [];
	try {
		lines = await flushJsonlDecoder(state, limits);
	} catch (error) {
		await writeFailure(
			error instanceof PlotProtocolFailure
				? error
				: new PlotProtocolFailure({
						code: "internal_error",
						message: errorMessage(error),
					}),
		);
	}
	for (const line of lines) await handleLine(line);
	for (let i = 0; i < 4; i++) await Promise.resolve();
};
