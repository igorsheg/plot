import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { isRecord } from "@plot/common/primitives";
import type { RuntimeEvent } from "./runtime.js";

/** Replay a session-owned durable event log. Missing files are empty logs. */
export async function* readSessionEvents(
	path: string,
): AsyncIterable<RuntimeEvent> {
	const exists = await stat(path).then(
		() => true,
		() => false,
	);
	if (!exists) return;
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
			if (!isRuntimeEvent(record)) continue;
			yield record;
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
	if (typeof record["sequence"] !== "number") return false;
	if (typeof record["timestamp"] !== "string") return false;
	if (!isRecord(record["event"])) return false;
	return true;
};

const noop = () => {};
const historyLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;

export interface SessionEventLogWriter {
	readonly append: (event: RuntimeEvent) => Promise<void>;
	readonly close: () => Promise<void>;
}

export const createSessionEventLogWriter = (
	path: string,
): SessionEventLogWriter => {
	let stream: WriteStream | undefined;
	let pending: Promise<void> = Promise.resolve();
	return {
		append: (event) => {
			if (!shouldWriteSessionEvent(event)) return pending;
			pending = pending
				.then(async () => {
					if (stream === undefined) {
						await mkdir(dirname(path), { recursive: true });
						stream = createWriteStream(path, { flags: "a" });
						stream.on("error", () => {
							stream = undefined;
						});
					}
					const target = stream;
					if (target === undefined) return;
					const line = stringifyJsonl(event, historyLimits);
					await new Promise<void>((resolve) => {
						target.write(line, () => resolve());
					});
					return undefined;
				})
				.catch(noop);
			return pending;
		},
		close: async () => {
			await pending.catch(noop);
			const target = stream;
			if (target === undefined) return;
			await new Promise<void>((resolve) => target.end(resolve));
			stream = undefined;
		},
	};
};
