import { isRecord } from "./primitives.js";

export type BoundaryErrorContextValue = string | number | boolean | null;

export interface BoundaryErrorRecord {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly context?: Readonly<Record<string, BoundaryErrorContextValue>>;
}

export class BoundaryError extends Error {
	override readonly name: string = "BoundaryError";
	readonly code: string;
	readonly retryable: boolean;
	readonly context: Readonly<Record<string, BoundaryErrorContextValue>>;

	constructor(record: BoundaryErrorRecord, options?: ErrorOptions) {
		super(record.message, options);
		this.code = record.code;
		this.retryable = record.retryable;
		this.context = record.context ?? {};
	}
}

const text = (value: unknown, label: string): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(`${label} must be a non-empty string`);
};

const context = (
	value: unknown,
): Readonly<Record<string, BoundaryErrorContextValue>> | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value))
		throw new Error("boundary error context must be an object");
	const decoded: Record<string, BoundaryErrorContextValue> = {};
	for (const [key, item] of Object.entries(value)) {
		if (
			typeof item !== "string" &&
			typeof item !== "number" &&
			typeof item !== "boolean" &&
			item !== null
		)
			throw new Error(`boundary error context ${key} must be a scalar`);
		decoded[key] = item;
	}
	return decoded;
};

export const parseBoundaryErrorRecord = (
	value: unknown,
): BoundaryErrorRecord => {
	if (!isRecord(value)) throw new Error("boundary error must be an object");
	if (typeof value["retryable"] !== "boolean")
		throw new Error("boundary error retryable must be a boolean");
	const record: {
		code: string;
		message: string;
		retryable: boolean;
		context?: Readonly<Record<string, BoundaryErrorContextValue>>;
	} = {
		code: text(value["code"], "boundary error code"),
		message: text(value["message"], "boundary error message"),
		retryable: value["retryable"],
	};
	const decodedContext = context(value["context"]);
	if (decodedContext !== undefined) record.context = decodedContext;
	return record;
};

const boundedMessage = (value: string): string => {
	const bytes = new TextEncoder().encode(value);
	if (bytes.length <= 4096) return value;
	let end = 4096;
	while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
	return new TextDecoder().decode(bytes.slice(0, end));
};

export const toBoundaryErrorRecord = (
	error: unknown,
	boundary: string,
): BoundaryErrorRecord => {
	if (error instanceof BoundaryError) {
		const record: {
			code: string;
			message: string;
			retryable: boolean;
			context?: Readonly<Record<string, BoundaryErrorContextValue>>;
		} = {
			code: error.code,
			message: boundedMessage(error.message),
			retryable: error.retryable,
		};
		if (Object.keys(error.context).length > 0) record.context = error.context;
		return record;
	}
	return {
		code: "internal_error",
		message: `Internal error at ${boundary}`,
		retryable: false,
		context: { boundary },
	};
};

export const boundaryErrorFromRecord = (
	record: BoundaryErrorRecord,
): BoundaryError => new BoundaryError(record);
