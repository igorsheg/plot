import { createReadStream } from "node:fs";
import { mkdir, open, stat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { hasErrnoCode, isRecord } from "@plot/common/primitives";
import type { RuntimeEvent } from "./runtime.js";

const historyLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;

const isRuntimeEvent = (value: unknown): value is RuntimeEvent => {
	if (!isRecord(value)) return false;
	if (value["kind"] !== "session_event" && value["kind"] !== "agent_event")
		return false;
	if (typeof value["sessionId"] !== "string") return false;
	if (
		typeof value["sequence"] !== "number" ||
		!Number.isInteger(value["sequence"]) ||
		value["sequence"] < 1
	)
		return false;
	return typeof value["timestamp"] === "string" && isRecord(value["event"]);
};

/** Replay a session-owned durable event log. Missing files are empty logs. */
export async function* readSessionEvents(
	path: string,
): AsyncIterable<RuntimeEvent> {
	try {
		await stat(path);
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return;
		throw error;
	}
	const stream = createReadStream(path);
	try {
		for await (const line of jsonlLines(stream, historyLimits)) {
			if (line.trim() === "") continue;
			try {
				const record = parseJsonl(line);
				if (isRuntimeEvent(record)) yield record;
			} catch {
				continue;
			}
		}
	} finally {
		stream.close();
	}
}

const historySkippedAgentEventTypes = new Set([
	// agent_end repeats the complete message history already owned by the
	// Agent Transcript; Session History only needs the preceding turn events.
	"agent_end",
	"thinking_delta",
	"text_delta",
	"message_delta",
	"message_partial",
	"toolcall_delta",
]);

const agentEventType = (event: unknown): string | undefined => {
	if (!isRecord(event)) return undefined;
	const update = event["assistantMessageEvent"];
	const nested = isRecord(update) ? update["type"] : undefined;
	const type = nested ?? event["type"];
	return typeof type === "string" ? type : undefined;
};

export const shouldWriteSessionEvent = (event: RuntimeEvent): boolean => {
	if (
		event.kind === "session_event" &&
		event.event.type === "source_interaction_open_url"
	)
		return false;
	return (
		event.kind !== "agent_event" ||
		!historySkippedAgentEventTypes.has(agentEventType(event.event) ?? "")
	);
};

export interface SessionEventLogWriter {
	readonly append: (event: RuntimeEvent) => Promise<void>;
	readonly close: () => Promise<void>;
}

/** Create a new durable log. Existing paths are rejected rather than resumed. */
export const createSessionEventLogWriter = (
	path: string,
): SessionEventLogWriter => {
	let file: FileHandle | undefined;
	let pending = Promise.resolve();
	const getFile = async (): Promise<FileHandle> => {
		if (file !== undefined) return file;
		await mkdir(dirname(path), { recursive: true });
		file = await open(path, "wx", 0o600);
		return file;
	};
	return {
		append: (event) => {
			if (!shouldWriteSessionEvent(event)) return pending;
			pending = pending.then(async () => {
				const target = await getFile();
				await target.writeFile(stringifyJsonl(event, historyLimits));
				return undefined;
			});
			return pending;
		},
		close: async () => {
			try {
				await pending;
			} finally {
				await file?.close();
				file = undefined;
			}
		},
	};
};
