import {
	PlotProtocolFailure,
	defaultPlotProtocolLimits,
	decodePlotClientRecord,
	type PlotClientRecord,
	type PlotProtocolLimits,
	type PlotServerRecord,
} from "@plot/session/protocol";
import { byteLength } from "./util.js";

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
const checkInputLineLimit = (line: string, limit: number) => {
	if (byteLength(line) > limit)
		throw new PlotProtocolFailure({
			code: "payload_too_large",
			message: "JSONL record exceeds maxInputLineBytes",
			details: { maxInputLineBytes: limit },
		});
};
const checkOutputRecordLimit = (line: string, limit: number) => {
	if (byteLength(line) > limit)
		throw new PlotProtocolFailure({
			code: "payload_too_large",
			message: "JSONL record exceeds maxOutputRecordBytes",
			details: { maxOutputRecordBytes: limit },
		});
};
const jsonProtocolReplacer = (_key: string, value: unknown) =>
	value instanceof Map ? [...value] : value;
export const serializeJsonLine = (value: PlotServerRecord): string =>
	`${JSON.stringify(value, jsonProtocolReplacer)}\n`;
export const serializePlotServerJsonLine = async (
	value: PlotServerRecord,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Promise<string> => {
	try {
		const line = serializeJsonLine(value);
		checkOutputRecordLimit(line, limits.maxOutputRecordBytes);
		return line;
	} catch (error) {
		if (error instanceof PlotProtocolFailure) throw error;
		throw new PlotProtocolFailure({
			code: "internal_error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
export const splitJsonlChunk = async (
	state: JsonlDecoderState,
	chunk: string,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Promise<JsonlChunkResult> => {
	const combined = `${state.pending}${chunk}`;
	const parts = combined.split("\n");
	const pending = parts.pop() ?? "";
	const lines = parts.map(stripTrailingCarriageReturn);
	for (const line of lines) checkInputLineLimit(line, limits.maxInputLineBytes);
	checkInputLineLimit(pending, limits.maxInputLineBytes);
	return { lines, state: { pending } };
};
export const flushJsonlDecoder = async (
	state: JsonlDecoderState,
	limits: PlotProtocolLimits = defaultPlotProtocolLimits,
): Promise<readonly string[]> => {
	if (state.pending === "") return [];
	const line = stripTrailingCarriageReturn(state.pending);
	checkInputLineLimit(line, limits.maxInputLineBytes);
	return [line];
};
const parseUnknownJson = (line: string): unknown => {
	try {
		return JSON.parse(line) as unknown;
	} catch (error) {
		throw new PlotProtocolFailure({
			code: "parse_error",
			message: error instanceof Error ? error.message : String(error),
		});
	}
};
export const parsePlotClientJsonLine = async (
	line: string,
): Promise<PlotClientRecord> => decodePlotClientRecord(parseUnknownJson(line));
