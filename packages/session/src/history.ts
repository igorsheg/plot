import { createReadStream } from "node:fs";
import { mkdir, open, stat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { hasErrnoCode, isRecord } from "@plot/common/primitives";
import type { RuntimeEvent } from "./runtime.js";

const historyLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;

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
			let record: unknown;
			try {
				record = parseJsonl(line);
			} catch {
				continue;
			}
			if (isRuntimeEvent(record)) yield record;
		}
	} finally {
		stream.close();
	}
}

const historySkippedAgentEventTypes = new Set([
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

export const shouldWriteSessionEvent = (event: RuntimeEvent): boolean =>
	event.kind !== "agent_event" ||
	!historySkippedAgentEventTypes.has(agentEventType(event.event) ?? "");

const isRuntimeEvent = (record: unknown): record is RuntimeEvent => {
	if (!isRecord(record)) return false;
	if (record["kind"] !== "session_event" && record["kind"] !== "agent_event")
		return false;
	if (typeof record["sessionId"] !== "string") return false;
	if (
		typeof record["sequence"] !== "number" ||
		!Number.isInteger(record["sequence"]) ||
		record["sequence"] < 1
	)
		return false;
	if (typeof record["timestamp"] !== "string") return false;
	if (!isRecord(record["event"])) return false;
	return true;
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
	let closed = false;
	const getFile = async (): Promise<FileHandle> => {
		if (file !== undefined) return file;
		await mkdir(dirname(path), { recursive: true });
		file = await open(path, "wx", 0o600);
		return file;
	};
	return {
		append: (event) => {
			if (closed)
				return Promise.reject(new Error("session event log is closed"));
			if (!shouldWriteSessionEvent(event)) return pending;
			pending = pending.then(async () => {
				const target = await getFile();
				await target.writeFile(stringifyJsonl(event, historyLimits));
				return undefined;
			});
			return pending;
		},
		close: async () => {
			if (closed) return pending;
			closed = true;
			try {
				await pending;
			} finally {
				await file?.close();
				file = undefined;
			}
		},
	};
};
