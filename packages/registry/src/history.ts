import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { isRecord } from "@plot/common/primitives";
import type { ServerRecord } from "@plot/session/protocol";

export type EventServerRecord = Extract<ServerRecord, { kind: "event" }>;

export const runHistoryPath = (historyDir: string, id: string): string =>
	join(historyDir, `${id}.jsonl`);

/** Replay a run's durable Session History (empty when none was written). */
export async function* readRunHistory(path: string): AsyncIterable<unknown> {
	const exists = await stat(path).then(
		() => true,
		() => false,
	);
	if (!exists) return;
	const stream = createReadStream(path);
	try {
		for await (const line of jsonlLines(stream, {
			maxLineBytes: 2 * 1024 * 1024,
		})) {
			if (line.trim() === "") continue;
			yield parseJsonl(line);
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

export const shouldWriteHistory = (record: EventServerRecord): boolean =>
	record.event.kind !== "agent_event" ||
	!historySkippedAgentEventTypes.has(agentEventType(record.event.event) ?? "");

const noop = () => {};
const historyLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;

export interface RunHistoryWriter {
	readonly append: (event: unknown) => Promise<void>;
	readonly close: () => Promise<void>;
}

// ponytail: history still grows unboundedly per run; add snapshot rotation when
// compacted files actually hurt.
export const createRunHistoryWriter = (path: string): RunHistoryWriter => {
	let stream: WriteStream | undefined;
	let pending: Promise<void> = Promise.resolve();
	return {
		append: (event) => {
			pending = pending
				.then(async () => {
					if (stream === undefined) {
						await mkdir(dirname(path), { recursive: true });
						stream = createWriteStream(path, { flags: "a" });
						stream.on("error", () => {
							// History is best-effort; a full disk must not kill the run.
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
