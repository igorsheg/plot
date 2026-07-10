import { byteLength, errorMessage } from "./primitives.js";

export interface JsonlLimits {
	readonly maxLineBytes: number;
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
		this.details = input.details;
	}
}

const lineSize = (line: string, limits: JsonlLimits): void => {
	const bytes = byteLength(line);
	if (bytes > limits.maxLineBytes)
		throw new JsonlBoundaryError({
			code: "line_too_large",
			message: "JSONL line exceeds maxLineBytes",
			details: { bytes, maxLineBytes: limits.maxLineBytes },
		});
};

const trimCarriageReturn = (line: string): string =>
	line.endsWith("\r") ? line.slice(0, -1) : line;

export async function* jsonlLines(
	chunks: AsyncIterable<string | Uint8Array>,
	limits: JsonlLimits,
): AsyncIterable<string> {
	const decoder = new TextDecoder();
	let pending = "";
	for await (const chunk of chunks) {
		pending +=
			typeof chunk === "string"
				? chunk
				: decoder.decode(chunk, { stream: true });
		let newline: number;
		while ((newline = pending.indexOf("\n")) >= 0) {
			const line = trimCarriageReturn(pending.slice(0, newline));
			pending = pending.slice(newline + 1);
			lineSize(line, limits);
			yield line;
		}
		lineSize(pending, limits);
	}
	pending += decoder.decode();
	if (pending) {
		const line = trimCarriageReturn(pending);
		lineSize(line, limits);
		yield line;
	}
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
