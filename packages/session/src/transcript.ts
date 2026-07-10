import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { hasErrnoCode, isRecord, type Mutable } from "@plot/common/primitives";
import { jsonlLines, parseJsonl } from "@plot/common/jsonl";

/** One display block of an Agent Transcript, flattened from pi's session store. */
export interface TranscriptEntry {
	readonly at?: string | undefined;
	readonly role: "user" | "assistant" | "tool";
	readonly kind: "text" | "thinking" | "tool-call" | "tool-result";
	readonly text: string;
	readonly name?: string | undefined;
}

// ponytail: hard bounds instead of pagination; a browser panel never needs
// more than the tail of a transcript, and the file stays on disk for the rest.
const maxEntryChars = 20_000;
const maxEntries = 500;

const clip = (text: string): string =>
	text.length > maxEntryChars ? `${text.slice(0, maxEntryChars)}\u2026` : text;

const str = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const blockEntry = (
	at: string | undefined,
	role: "user" | "assistant" | "toolResult",
	block: unknown,
): TranscriptEntry | undefined => {
	if (!isRecord(block)) return undefined;
	const type = block["type"];
	if (type === "text") {
		const text = str(block["text"]);
		if (text === undefined || text === "") return undefined;
		return role === "toolResult"
			? { at, role: "tool", kind: "tool-result", text: clip(text) }
			: { at, role, kind: "text", text: clip(text) };
	}
	if (type === "thinking") {
		const text = str(block["thinking"]);
		if (text === undefined || text === "") return undefined;
		return { at, role: "assistant", kind: "thinking", text: clip(text) };
	}
	if (type === "toolCall") {
		const name = str(block["name"]) ?? str(block["toolName"]);
		const args = block["arguments"] ?? block["args"];
		const entry: Mutable<TranscriptEntry> = {
			at,
			role: "assistant",
			kind: "tool-call",
			text: clip(args === undefined ? "" : JSON.stringify(args, null, 1)),
		};
		if (name !== undefined) entry.name = name;
		return entry;
	}
	return undefined;
};

/** Read a pi transcript file into display entries (empty when missing). */
export const readAgentTranscript = async (
	path: string,
): Promise<readonly TranscriptEntry[]> => {
	try {
		await stat(path);
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return [];
		throw error;
	}
	const entries: TranscriptEntry[] = [];
	const stream = createReadStream(path);
	try {
		for await (const line of jsonlLines(stream, {
			maxLineBytes: 16 * 1024 * 1024,
		})) {
			if (line.trim() === "") continue;
			const record = parseJsonl(line);
			if (!isRecord(record) || record["type"] !== "message") continue;
			const message = record["message"];
			if (!isRecord(message)) continue;
			const role = message["role"];
			if (role !== "user" && role !== "assistant" && role !== "toolResult")
				continue;
			const at = str(record["timestamp"]);
			const content = message["content"];
			const blocks = Array.isArray(content)
				? content
				: typeof content === "string"
					? [{ type: "text", text: content }]
					: [];
			for (const block of blocks) {
				const entry = blockEntry(at, role, block);
				if (entry !== undefined) entries.push(entry);
			}
		}
	} catch {
		// A truncated or oversized tail must not lose the readable prefix.
	} finally {
		stream.close();
	}
	return entries.slice(-maxEntries);
};
