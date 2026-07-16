import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { readAgentTranscript } from "../src/transcript.js";

const line = (value: unknown) => JSON.stringify(value);

test("transcript reader flattens agent message blocks into display entries", async () => {
	const dir = await mkdtemp(join(tmpdir(), "agent-transcript-"));
	const path = join(dir, "transcript.jsonl");
	await writeFile(
		path,
		[
			line({ type: "session", version: 3, id: "agent-1" }),
			line({ type: "model_change", modelId: "gpt" }),
			line({
				type: "message",
				timestamp: "t1",
				message: {
					role: "user",
					content: [{ type: "text", text: "review PR #7" }],
				},
			}),
			line({
				type: "message",
				timestamp: "t2",
				message: {
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan the review" },
						{ type: "toolCall", name: "read", arguments: { path: "a.ts" } },
					],
				},
			}),
			line({
				type: "message",
				timestamp: "t3",
				message: {
					role: "toolResult",
					content: [{ type: "text", text: "file contents" }],
				},
			}),
		].join("\n"),
	);

	const entries = await readAgentTranscript(path);
	expect(entries.map((entry) => `${entry.role}:${entry.kind}`)).toEqual([
		"user:text",
		"assistant:thinking",
		"assistant:tool-call",
		"tool:tool-result",
	]);
	expect(entries[2]?.name).toBe("read");
	expect(await readAgentTranscript(join(dir, "missing.jsonl"))).toEqual([]);
});
