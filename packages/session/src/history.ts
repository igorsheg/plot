import { createReadStream } from "node:fs";
import { mkdir, open, stat, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { hasErrnoCode, isRecord } from "@plot/common/primitives";
import type { RuntimeEvent, SessionEventStore } from "./runtime.js";

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

/** Create a new durable log. Existing paths are rejected rather than resumed. */
export const createSessionEventLogWriter = (path: string) => {
	let file: FileHandle | undefined;
	let closed = false;
	const getFile = async (): Promise<FileHandle> => {
		if (closed) throw new Error("Session event store is closed");
		if (file !== undefined) return file;
		await mkdir(dirname(path), { recursive: true });
		file = await open(path, "wx", 0o600);
		return file;
	};
	return {
		append: async (event: RuntimeEvent) => {
			const target = await getFile();
			await target.writeFile(stringifyJsonl(event, historyLimits));
		},
		close: async () => {
			closed = true;
			await file?.close();
			file = undefined;
		},
	};
};

export const createJsonlSessionEventStore = (
	path: string,
): SessionEventStore => {
	const writer = createSessionEventLogWriter(path);
	return {
		append: writer.append,
		read: (after = 0) => ({
			async *[Symbol.asyncIterator]() {
				for await (const event of readSessionEvents(path))
					if (event.sequence > after) yield event;
			},
		}),
		close: writer.close,
	};
};
