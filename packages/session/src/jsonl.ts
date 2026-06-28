import { byteLength, errorMessage } from "./primitives.js";

export interface JsonlLimits {
	readonly maxLineBytes: number;
}

export interface JsonlDecodeState {
	readonly pending: string;
}

export interface JsonlDecodeResult {
	readonly lines: readonly string[];
	readonly state: JsonlDecodeState;
}

export type JsonlErrorCode =
	| "line_too_large"
	| "record_too_large"
	| "parse_error";

export class JsonlBoundaryError extends Error {
	override readonly name = "JsonlBoundaryError";
	readonly code: JsonlErrorCode;
	readonly details?: unknown;

	constructor(input: {
		readonly code: JsonlErrorCode;
		readonly message: string;
		readonly details?: unknown;
	}) {
		super(input.message);
		this.code = input.code;
		if (input.details !== undefined) this.details = input.details;
	}
}

export const emptyJsonlDecodeState: JsonlDecodeState = { pending: "" };

const trimCarriageReturn = (line: string): string =>
	line.endsWith("\r") ? line.slice(0, -1) : line;

const assertLineSize = (line: string, limits: JsonlLimits): void => {
	const bytes = byteLength(line);
	if (bytes <= limits.maxLineBytes) return;
	throw new JsonlBoundaryError({
		code: "line_too_large",
		message: "JSONL line exceeds maxLineBytes",
		details: { bytes, maxLineBytes: limits.maxLineBytes },
	});
};

export const splitJsonl = (
	state: JsonlDecodeState,
	chunk: string,
	limits: JsonlLimits,
): JsonlDecodeResult => {
	const parts = `${state.pending}${chunk}`.split("\n");
	const pending = parts.pop() ?? "";
	const lines = parts.map(trimCarriageReturn);
	for (const line of lines) assertLineSize(line, limits);
	assertLineSize(pending, limits);
	return { lines, state: { pending } };
};

export const flushJsonl = (
	state: JsonlDecodeState,
	limits: JsonlLimits,
): readonly string[] => {
	if (state.pending === "") return [];
	const line = trimCarriageReturn(state.pending);
	assertLineSize(line, limits);
	return [line];
};

export async function* jsonlLines(
	chunks: AsyncIterable<string | Uint8Array>,
	limits: JsonlLimits,
): AsyncIterable<string> {
	const decoder = new TextDecoder();
	let state = emptyJsonlDecodeState;
	for await (const chunk of chunks) {
		const text =
			typeof chunk === "string"
				? chunk
				: decoder.decode(chunk, { stream: true });
		const decoded = splitJsonl(state, text, limits);
		state = decoded.state;
		for (const line of decoded.lines) yield line;
	}
	const finalText = decoder.decode();
	if (finalText !== "") {
		const decoded = splitJsonl(state, finalText, limits);
		state = decoded.state;
		for (const line of decoded.lines) yield line;
	}
	for (const line of flushJsonl(state, limits)) yield line;
}

const jsonReplacer = (_key: string, value: unknown) =>
	value instanceof Map ? Object.fromEntries(value) : value;

export const stringifyJsonl = (value: unknown, limits: JsonlLimits): string => {
	const line = `${JSON.stringify(value, jsonReplacer)}\n`;
	const bytes = byteLength(line);
	if (bytes <= limits.maxLineBytes) return line;
	throw new JsonlBoundaryError({
		code: "record_too_large",
		message: "JSONL record exceeds maxLineBytes",
		details: { bytes, maxLineBytes: limits.maxLineBytes },
	});
};

export const parseJsonl = (line: string): unknown => {
	try {
		return JSON.parse(line) as unknown;
	} catch (error) {
		throw new JsonlBoundaryError({
			code: "parse_error",
			message: errorMessage(error),
		});
	}
};
