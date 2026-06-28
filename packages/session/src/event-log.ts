import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { parseJsonl, stringifyJsonl, type JsonlLimits } from "./jsonl.js";
import { errorMessage } from "./primitives.js";

const nonEmptyString = z.string().min(1);
const positiveInteger = z.number().int().positive();

export const sessionEventSchema = z
	.object({
		kind: z.literal("session_event"),
		sessionId: nonEmptyString,
		sequence: positiveInteger,
		timestamp: nonEmptyString,
		type: nonEmptyString,
		payload: z.unknown().optional(),
	})
	.strict();

export const agentEventSchema = z
	.object({
		kind: z.literal("agent_event"),
		sessionId: nonEmptyString,
		sequence: positiveInteger,
		timestamp: nonEmptyString,
		sourceId: nonEmptyString.optional(),
		runId: nonEmptyString.optional(),
		workKey: nonEmptyString.optional(),
		event: z.unknown(),
	})
	.strict();

export const eventLogRecordSchema = z.discriminatedUnion("kind", [
	sessionEventSchema,
	agentEventSchema,
]);

export type EventLogRecord = z.infer<typeof eventLogRecordSchema>;

export interface EventLogAppendInput {
	readonly type: string;
	readonly payload?: unknown;
	readonly timestamp?: string;
}

export interface AgentEventAppendInput {
	readonly sourceId?: string;
	readonly runId?: string;
	readonly workKey?: string;
	readonly event: unknown;
	readonly timestamp?: string;
}

export interface EventLogFrontier {
	readonly sessionId: string;
	readonly lastSequence: number;
	readonly byteOffset: number;
	readonly path: string;
}

export interface EventLogDiagnostic {
	readonly level: "warning";
	readonly phase: "parse";
	readonly path: string;
	readonly lineNumber: number;
	readonly message: string;
}

export interface EventLogReadResult {
	readonly records: readonly EventLogRecord[];
	readonly diagnostics: readonly EventLogDiagnostic[];
	readonly frontier: EventLogFrontier;
}

export class EventLogError extends Error {
	override readonly name = "EventLogError";
	readonly phase: "read" | "parse" | "write";
	readonly path: string;
	readonly lineNumber?: number;

	constructor(input: {
		readonly phase: "read" | "parse" | "write";
		readonly path: string;
		readonly message: string;
		readonly lineNumber?: number;
	}) {
		super(input.message);
		this.phase = input.phase;
		this.path = input.path;
		if (input.lineNumber !== undefined) this.lineNumber = input.lineNumber;
	}
}

export interface EventLogStore {
	readonly sessionId: string;
	readonly path: string;
	readonly appendSessionEvent: (
		input: EventLogAppendInput,
	) => Promise<EventLogRecord>;
	readonly appendAgentEvent: (
		input: AgentEventAppendInput,
	) => Promise<EventLogRecord>;
	readonly readAll: () => Promise<EventLogReadResult>;
	readonly readFrom: (
		frontier: EventLogFrontier,
	) => Promise<readonly EventLogRecord[]>;
	readonly frontier: () => Promise<EventLogFrontier>;
}

export interface FileEventLogStoreOptions {
	readonly sessionId: string;
	readonly sessionDir: string;
	readonly path?: string;
	readonly limits?: JsonlLimits;
}

const defaultJsonlLimits: JsonlLimits = { maxLineBytes: 2 * 1024 * 1024 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isErrnoCode = (error: unknown, code: string): boolean =>
	isRecord(error) && error["code"] === code;

const optionalString = (key: string, value: string | undefined) =>
	value === undefined ? {} : { [key]: value };

const lastSequence = (records: readonly EventLogRecord[]): number =>
	records.at(-1)?.sequence ?? 0;

const readText = async (path: string): Promise<string> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) return "";
		throw new EventLogError({
			phase: "read",
			path,
			message: errorMessage(error),
		});
	}
};

const fileSize = async (path: string): Promise<number> => {
	try {
		return (await stat(path)).size;
	} catch (error) {
		if (isErrnoCode(error, "ENOENT")) return 0;
		throw new EventLogError({
			phase: "read",
			path,
			message: errorMessage(error),
		});
	}
};

export const makeSessionEventRecord = (input: {
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp?: string;
	readonly event: EventLogAppendInput;
}): EventLogRecord =>
	eventLogRecordSchema.parse({
		kind: "session_event",
		sessionId: input.sessionId,
		sequence: input.sequence,
		timestamp:
			input.event.timestamp ?? input.timestamp ?? new Date().toISOString(),
		type: input.event.type,
		...(input.event.payload === undefined
			? {}
			: { payload: input.event.payload }),
	});

export const makeAgentEventRecord = (input: {
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp?: string;
	readonly event: AgentEventAppendInput;
}): EventLogRecord =>
	eventLogRecordSchema.parse({
		kind: "agent_event",
		sessionId: input.sessionId,
		sequence: input.sequence,
		timestamp:
			input.event.timestamp ?? input.timestamp ?? new Date().toISOString(),
		...optionalString("sourceId", input.event.sourceId),
		...optionalString("runId", input.event.runId),
		...optionalString("workKey", input.event.workKey),
		event: input.event.event,
	});

const normalizeEventLogRecord = (value: unknown): unknown => {
	if (!isRecord(value)) return value;
	if (value["kind"] === "plot_event")
		return {
			kind: "session_event",
			sessionId: value["sessionId"],
			sequence: value["sequence"],
			timestamp: value["timestamp"],
			type: value["type"],
			...(value["payload"] === undefined ? {} : { payload: value["payload"] }),
		};
	if (value["kind"] === "agent_session_event")
		return {
			kind: "agent_event",
			sessionId: value["sessionId"],
			sequence: value["sequence"],
			timestamp: value["timestamp"],
			...(typeof value["sourceId"] === "string"
				? { sourceId: value["sourceId"] }
				: {}),
			...(typeof value["runId"] === "string" ? { runId: value["runId"] } : {}),
			...(typeof value["workKey"] === "string"
				? { workKey: value["workKey"] }
				: {}),
			event: value["event"],
		};
	return value;
};

export const decodeEventLogRecord = (value: unknown): EventLogRecord =>
	eventLogRecordSchema.parse(normalizeEventLogRecord(value));

const decodeLine = (line: string, sessionId: string): EventLogRecord => {
	const record = decodeEventLogRecord(parseJsonl(line));
	if (record.sessionId !== sessionId)
		throw new Error(
			`event sessionId ${record.sessionId} does not match ${sessionId}`,
		);
	return record;
};

const corruptTailDiagnostic = (
	path: string,
	lineNumber: number,
	error: unknown,
): EventLogDiagnostic => ({
	level: "warning",
	phase: "parse",
	path,
	lineNumber,
	message: `ignored corrupt final event log line: ${errorMessage(error)}`,
});

const parseText = (
	path: string,
	sessionId: string,
	text: string,
): Pick<EventLogReadResult, "records" | "diagnostics"> => {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	const records: EventLogRecord[] = [];
	const diagnostics: EventLogDiagnostic[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined || line.trim() === "") continue;
		const lineNumber = index + 1;
		try {
			records.push(decodeLine(line, sessionId));
		} catch (error) {
			if (index === lines.length - 1) {
				diagnostics.push(corruptTailDiagnostic(path, lineNumber, error));
				continue;
			}
			throw new EventLogError({
				phase: "parse",
				path,
				lineNumber,
				message: errorMessage(error),
			});
		}
	}
	return { records, diagnostics };
};

const readAllFromDisk = async (
	path: string,
	sessionId: string,
): Promise<EventLogReadResult> => {
	const text = await readText(path);
	const parsed = parseText(path, sessionId, text);
	return {
		...parsed,
		frontier: {
			sessionId,
			lastSequence: lastSequence(parsed.records),
			byteOffset: Buffer.byteLength(text, "utf8"),
			path,
		},
	};
};

export const createFileEventLogStore = async (
	options: FileEventLogStoreOptions,
): Promise<EventLogStore> => {
	const path =
		options.path ?? join(options.sessionDir, options.sessionId, "events.jsonl");
	const limits = options.limits ?? defaultJsonlLimits;
	const initial = await readAllFromDisk(path, options.sessionId);
	let cachedLastSequence = initial.frontier.lastSequence;
	let cachedByteOffset = await fileSize(path);
	let appendChain = Promise.resolve();

	const currentFrontier = async (): Promise<EventLogFrontier> => ({
		sessionId: options.sessionId,
		lastSequence: cachedLastSequence,
		byteOffset: cachedByteOffset,
		path,
	});

	const appendRecord = async (
		makeRecord: (sequence: number) => EventLogRecord,
	): Promise<EventLogRecord> => {
		const record = makeRecord(cachedLastSequence + 1);
		try {
			await mkdir(dirname(path), { recursive: true });
			const line = stringifyJsonl(record, limits);
			await appendFile(path, line, "utf8");
			cachedLastSequence = record.sequence;
			cachedByteOffset += Buffer.byteLength(line, "utf8");
			return record;
		} catch (error) {
			throw new EventLogError({
				phase: "write",
				path,
				message: errorMessage(error),
			});
		}
	};

	const append = (
		makeRecord: (sequence: number) => EventLogRecord,
	): Promise<EventLogRecord> => {
		const result = appendChain.then(() => appendRecord(makeRecord));
		appendChain = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	};

	return {
		sessionId: options.sessionId,
		path,
		appendSessionEvent: (event) =>
			append((sequence) =>
				makeSessionEventRecord({
					sessionId: options.sessionId,
					sequence,
					event,
				}),
			),
		appendAgentEvent: (event) =>
			append((sequence) =>
				makeAgentEventRecord({
					sessionId: options.sessionId,
					sequence,
					event,
				}),
			),
		readAll: () => readAllFromDisk(path, options.sessionId),
		readFrom: async (frontier) => {
			const read = await readAllFromDisk(path, options.sessionId);
			return read.records.filter(
				(record) => record.sequence > frontier.lastSequence,
			);
		},
		frontier: currentFrontier,
	};
};

export const createEventLogSessionId = (): string => `session-${randomUUID()}`;
