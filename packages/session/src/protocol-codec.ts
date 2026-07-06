import { byteLength, errorMessage } from "@plot/common/primitives";
import {
	JsonlBoundaryError,
	parseJsonl,
	stringifyJsonl,
	type JsonlLimits,
} from "@plot/common/jsonl";
import {
	ProtocolBoundaryError,
	decodeClientRequest,
	decodeServerRecord,
	defaultProtocolLimits,
	serverRecordSchema,
	type ClientRequest,
	type ProtocolLimits,
	type ServerRecord,
} from "./protocol.js";
import { encodeBoundary } from "./schema.js";

const outputLimits = (limits: ProtocolLimits): JsonlLimits => ({
	maxLineBytes: limits.maxOutputLineBytes,
});

const mapDecodeError = (error: unknown): ProtocolBoundaryError => {
	if (error instanceof ProtocolBoundaryError) return error;
	if (error instanceof JsonlBoundaryError)
		return new ProtocolBoundaryError({
			code: error.code === "parse_error" ? "parse_error" : "payload_too_large",
			message: error.message,
			...(error.details === undefined ? {} : { details: error.details }),
		});
	return new ProtocolBoundaryError({
		code: "invalid_request",
		message: errorMessage(error),
	});
};

export const encodeServerRecordLine = (
	record: ServerRecord,
	limits: ProtocolLimits = defaultProtocolLimits,
): string => {
	try {
		return stringifyJsonl(
			encodeBoundary(serverRecordSchema, record),
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
		return decodeClientRequest(parseJsonl(line));
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
		return decodeServerRecord(parseJsonl(line));
	} catch (error) {
		throw mapDecodeError(error);
	}
};
