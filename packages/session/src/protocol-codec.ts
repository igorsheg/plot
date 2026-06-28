import { ZodError } from "zod";
import {
	JsonlBoundaryError,
	parseJsonl,
	stringifyJsonl,
	type JsonlLimits,
} from "./jsonl.js";
import { byteLength } from "@plot/common/primitives";
import {
	ProtocolBoundaryError,
	clientRequestSchema,
	defaultProtocolLimits,
	serverRecordSchema,
	type ClientRequest,
	type ProtocolLimits,
	type ServerRecord,
} from "./protocol.js";

const outputLimits = (limits: ProtocolLimits): JsonlLimits => ({
	maxLineBytes: limits.maxOutputLineBytes,
});

const formatZodError = (error: ZodError): string =>
	error.issues
		.map((issue) => {
			const path = issue.path.length === 0 ? "record" : issue.path.join(".");
			return `${path}: ${issue.message}`;
		})
		.join("; ");

const mapDecodeError = (error: unknown): ProtocolBoundaryError => {
	if (error instanceof ProtocolBoundaryError) return error;
	if (error instanceof JsonlBoundaryError)
		return new ProtocolBoundaryError({
			code: error.code === "parse_error" ? "parse_error" : "payload_too_large",
			message: error.message,
			...(error.details === undefined ? {} : { details: error.details }),
		});
	if (error instanceof ZodError)
		return new ProtocolBoundaryError({
			code: "invalid_request",
			message: formatZodError(error),
		});
	return new ProtocolBoundaryError({
		code: "invalid_request",
		message: error instanceof Error ? error.message : String(error),
	});
};

export const encodeServerRecordLine = (
	record: ServerRecord,
	limits: ProtocolLimits = defaultProtocolLimits,
): string => {
	try {
		return stringifyJsonl(
			serverRecordSchema.parse(record),
			outputLimits(limits),
		);
	} catch (error) {
		if (error instanceof JsonlBoundaryError)
			throw new ProtocolBoundaryError({
				code: "payload_too_large",
				message: error.message,
				...(error.details === undefined ? {} : { details: error.details }),
			});
		throw mapDecodeError(error);
	}
};

const assertInputLineSize = (line: string, limits: ProtocolLimits): void => {
	const bytes = byteLength(line);
	if (bytes <= limits.maxInputLineBytes) return;
	throw new ProtocolBoundaryError({
		code: "payload_too_large",
		message: "protocol input line exceeds maxInputLineBytes",
		details: { bytes, maxInputLineBytes: limits.maxInputLineBytes },
	});
};

export const decodeClientRequestLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ClientRequest => {
	try {
		assertInputLineSize(line, limits);
		return clientRequestSchema.parse(parseJsonl(line));
	} catch (error) {
		throw mapDecodeError(error);
	}
};

export const decodeServerRecordLine = (
	line: string,
	limits: ProtocolLimits = defaultProtocolLimits,
): ServerRecord => {
	try {
		assertInputLineSize(line, limits);
		return serverRecordSchema.parse(parseJsonl(line));
	} catch (error) {
		throw mapDecodeError(error);
	}
};
