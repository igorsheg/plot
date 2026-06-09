import { Effect, Schema } from "effect";
import {
	PlotProtocolFailure,
	PlotServerRecord,
	defaultPlotProtocolLimits,
	decodePlotClientRecord,
	type PlotClientRecord,
	type PlotProtocolLimits,
	type PlotServerRecord as PlotServerRecordType,
} from "./protocol.js";

export interface JsonlDecoderState {
	readonly pending: string;
}

export interface JsonlChunkResult {
	readonly lines: readonly string[];
	readonly state: JsonlDecoderState;
}

export const initialJsonlDecoderState: JsonlDecoderState = { pending: "" };

const stripTrailingCarriageReturn = (line: string) =>
	line.endsWith("\r") ? line.slice(0, -1) : line;

const byteLength = (value: string) => new TextEncoder().encode(value).length;

const checkInputLineLimit = (line: string, limit: number) => {
	if (byteLength(line) <= limit) return Effect.void;
	return new PlotProtocolFailure({
		code: "payload_too_large",
		message: "JSONL record exceeds maxInputLineBytes",
		details: { maxInputLineBytes: limit },
	});
};

const checkOutputRecordLimit = (line: string, limit: number) => {
	if (byteLength(line) <= limit) return Effect.void;
	return new PlotProtocolFailure({
		code: "payload_too_large",
		message: "JSONL record exceeds maxOutputRecordBytes",
		details: { maxOutputRecordBytes: limit },
	});
};

const jsonProtocolReplacer = (_key: string, value: unknown) =>
	value instanceof Map ? [...value] : value;

export const serializeJsonLine = (value: PlotServerRecordType): string =>
	`${JSON.stringify(
		Schema.encodeSync(PlotServerRecord)(value),
		jsonProtocolReplacer,
	)}\n`;

export const serializePlotServerJsonLine = (
	value: PlotServerRecordType,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Effect.Effect<string, PlotProtocolFailure> =>
	Effect.try({
		try: () => serializeJsonLine(value),
		catch: (error) =>
			new PlotProtocolFailure({
				code: "internal_error",
				message: error instanceof Error ? error.message : String(error),
			}),
	}).pipe(
		Effect.tap((line) =>
			checkOutputRecordLimit(line, limits.maxOutputRecordBytes),
		),
	);

export const splitJsonlChunk = (
	state: JsonlDecoderState,
	chunk: string,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Effect.Effect<JsonlChunkResult, PlotProtocolFailure> =>
	Effect.gen(function* () {
		const combined = `${state.pending}${chunk}`;
		const parts = combined.split("\n");
		const pending = parts.pop() ?? "";
		const lines = parts.map(stripTrailingCarriageReturn);
		for (const line of lines) {
			yield* checkInputLineLimit(line, limits.maxInputLineBytes);
		}
		yield* checkInputLineLimit(pending, limits.maxInputLineBytes);
		return {
			lines,
			state: { pending },
		};
	});

export const flushJsonlDecoder = (
	state: JsonlDecoderState,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Effect.Effect<readonly string[], PlotProtocolFailure> =>
	Effect.gen(function* () {
		if (state.pending === "") return [];
		const line = stripTrailingCarriageReturn(state.pending);
		yield* checkInputLineLimit(line, limits.maxInputLineBytes);
		return [line];
	});

const parseUnknownJson = (line: string) =>
	Effect.try({
		try: () => JSON.parse(line) as unknown,
		catch: (error) =>
			new PlotProtocolFailure({
				code: "parse_error",
				message: error instanceof Error ? error.message : String(error),
			}),
	});

export const parsePlotClientJsonLine = (
	line: string,
): Effect.Effect<PlotClientRecord, PlotProtocolFailure> =>
	parseUnknownJson(line).pipe(Effect.flatMap(decodePlotClientRecord));
