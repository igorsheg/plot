import { randomUUID } from "node:crypto";
import { mkdir, readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import {
	safeParseEventLogEvent,
	type EventLogEvent,
	type EventLogSequence,
} from "@plot/session/protocol";
import { errorMessage } from "./util.js";

export interface EventLogDiagnostic {
	readonly level: "warning";
	readonly phase: "read" | "parse";
	readonly message: string;
	readonly path: string;
	readonly lineNumber?: number;
}

export class PlotEventLogError extends Error {
	override readonly name = "PlotEventLogError";
	readonly phase: "read" | "parse" | "write";
	readonly path: string;
	readonly lineNumber?: number | undefined;
	constructor(input: {
		readonly phase: "read" | "parse" | "write";
		readonly message: string;
		readonly path: string;
		readonly lineNumber?: number | undefined;
	}) {
		super(input.message);
		this.phase = input.phase;
		this.path = input.path;
		this.lineNumber = input.lineNumber;
	}
}

export interface EventLogFrontier {
	readonly sessionId: string;
	readonly epoch: string;
	readonly lastSequence: number;
	readonly path: string;
}

export interface EventLogReadResult {
	readonly events: readonly EventLogEvent[];
	readonly diagnostics: readonly EventLogDiagnostic[];
	readonly frontier: EventLogFrontier;
}

export interface EventLogAppendInput {
	readonly type: string;
	readonly payload?: unknown;
	readonly timestamp?: string;
}

export interface EventLogStoreOptions {
	readonly sessionDir: string;
	readonly sessionId: string;
	readonly epoch?: string;
}

export interface EventLogStore {
	readonly sessionId: string;
	readonly epoch: string;
	readonly sessionPath: string;
	readonly eventLogPath: string;
	readonly append: (event: EventLogAppendInput) => Promise<EventLogEvent>;
	readonly frontier: () => Promise<EventLogFrontier>;
	readonly readAll: () => Promise<EventLogReadResult>;
}

export const createEventLogEpoch = (): string => `epoch-${randomUUID()}`;

const isNoEntryError = (error: unknown) =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "ENOENT";

const incompleteTailDiagnostic = (
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

const readEventLogFile = async (path: string) => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isNoEntryError(error)) return "";
		throw new PlotEventLogError({
			phase: "read",
			path,
			message: errorMessage(error),
		});
	}
};

const parseEventLogText = (
	path: string,
	text: string,
): Pick<EventLogReadResult, "events" | "diagnostics"> => {
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	const events: EventLogEvent[] = [];
	const diagnostics: EventLogDiagnostic[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined || line.trim() === "") continue;
		const lineNumber = index + 1;
		const isFinalLine = index === lines.length - 1;
		try {
			const parsedJson = JSON.parse(line) as unknown;
			const parsedEvent = safeParseEventLogEvent(parsedJson);
			if (!parsedEvent.success) throw parsedEvent.error;
			events.push(parsedEvent.data as EventLogEvent);
		} catch (error) {
			if (isFinalLine) {
				diagnostics.push(incompleteTailDiagnostic(path, lineNumber, error));
				continue;
			}
			throw new PlotEventLogError({
				phase: "parse",
				path,
				lineNumber,
				message: errorMessage(error),
			});
		}
	}
	return { events, diagnostics };
};

const lastSequenceOf = (events: readonly EventLogEvent[]) =>
	Number(events.at(-1)?.sequence ?? 0);

const jsonEventLogReplacer = (_key: string, value: unknown) =>
	value instanceof Map ? [...value] : value;

const readFromDisk = async (
	path: string,
	sessionId: string,
	epoch: string,
): Promise<EventLogReadResult> => {
	const parsed = parseEventLogText(path, await readEventLogFile(path));
	return {
		...parsed,
		frontier: {
			sessionId,
			epoch,
			lastSequence: lastSequenceOf(parsed.events),
			path,
		},
	};
};

export const readEventLogPath = async (input: {
	readonly path: string;
	readonly sessionId: string;
	readonly epoch?: string | undefined;
}): Promise<EventLogReadResult> =>
	readFromDisk(input.path, input.sessionId, input.epoch ?? "web");

export const createEventLogStore = async (
	options: EventLogStoreOptions,
): Promise<EventLogStore> => {
	const epoch = options.epoch ?? createEventLogEpoch();
	const sessionPath = join(options.sessionDir, options.sessionId);
	const eventLogPath = join(sessionPath, "events.jsonl");
	let cachedLastSequence = lastSequenceOf(
		(await readFromDisk(eventLogPath, options.sessionId, epoch)).events,
	);
	let appendChain = Promise.resolve();

	const frontier = async (): Promise<EventLogFrontier> => ({
		sessionId: options.sessionId,
		epoch,
		lastSequence: cachedLastSequence,
		path: eventLogPath,
	});

	const appendUnsafe = async (
		input: EventLogAppendInput,
	): Promise<EventLogEvent> => {
		const sequence = (cachedLastSequence + 1) as EventLogSequence;
		const timestamp = input.timestamp ?? new Date().toISOString();
		const payload = input.payload ?? {};
		const payloadRecord = payload as Record<string, unknown>;
		const event =
			input.type === "agent_run_event" &&
			typeof payload === "object" &&
			payload !== null &&
			"event" in payload
				? {
						kind: "agent_session_event" as const,
						sessionId: options.sessionId,
						sequence,
						timestamp,
						type: "agent_session_event",
						...(typeof payloadRecord["sourceId"] === "string"
							? { sourceId: payloadRecord["sourceId"] }
							: {}),
						...(typeof payloadRecord["runId"] === "string"
							? { runId: payloadRecord["runId"] }
							: {}),
						...(typeof payloadRecord["workKey"] === "string"
							? { workKey: payloadRecord["workKey"] }
							: {}),
						event: payloadRecord["event"],
					}
				: {
						kind: "plot_event" as const,
						sessionId: options.sessionId,
						sequence,
						timestamp,
						type: input.type,
						payload,
					};
		const parsed = safeParseEventLogEvent(event);
		if (!parsed.success)
			throw new PlotEventLogError({
				phase: "write",
				path: eventLogPath,
				message: errorMessage(parsed.error),
			});
		try {
			await mkdir(sessionPath, { recursive: true });
			await appendFile(
				eventLogPath,
				`${JSON.stringify(parsed.data, jsonEventLogReplacer)}\n`,
				"utf8",
			);
			cachedLastSequence = Number(parsed.data.sequence);
			return parsed.data as EventLogEvent;
		} catch (error) {
			throw new PlotEventLogError({
				phase: "write",
				path: eventLogPath,
				message: errorMessage(error),
			});
		}
	};

	const store: EventLogStore = {
		sessionId: options.sessionId,
		epoch,
		sessionPath,
		eventLogPath,
		append: (input) => {
			const appended = appendChain.then(() => appendUnsafe(input));
			appendChain = appended.then(
				() => undefined,
				() => undefined,
			);
			return appended;
		},
		frontier,
		readAll: async () => readFromDisk(eventLogPath, options.sessionId, epoch),
	};
	return store;
};
