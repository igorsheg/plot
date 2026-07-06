import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiAgentSessionPort } from "../src/pi-runner.js";
import {
	decodeServerRecordLine,
	sessionProtocolVersion,
} from "../src/protocol.js";
import type { RuntimeEvent } from "../src/runtime.js";
import { runSessionOnce, serveSessionStdio } from "../src/serve.js";

class FakePiSession implements PiAgentSessionPort {
	readonly listeners = new Set<(event: AgentSessionEvent) => void>();

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(_text: string, _options?: PromptOptions): Promise<void> {}

	dispose(): void {}
}

const tempDirs: string[] = [];

async function* chunks(values: readonly string[]) {
	for (const value of values) yield value;
}

const makeWorkflowDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-serve-"));
	tempDirs.push(dir);
	await writeFile(join(dir, "WORKFLOW.md"), "Run the workflow.\n");
	return dir;
};

describe("session serve", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("serveSessionStdio answers a ping over JSONL lines", async () => {
		const dir = await makeWorkflowDir();
		const lines: string[] = [];
		const stdin = chunks([
			`${JSON.stringify({
				protocol: sessionProtocolVersion,
				kind: "request",
				id: "t1",
				command: "ping",
			})}\n`,
		]);

		await serveSessionStdio({
			cwd: dir,
			sessionId: "serve-test",
			stdin,
			writeLine: (line) => {
				lines.push(line);
			},
		});

		expect(decodeServerRecordLine(lines[0] ?? "").kind).toBe("welcome");
		expect(
			lines.some((line) => {
				const record = decodeServerRecordLine(line);
				return record.kind === "response" && record.id === "t1" && record.ok;
			}),
		).toBe(true);
	});

	test("runSessionOnce streams runtime events to onEvent", async () => {
		const dir = await makeWorkflowDir();
		const events: RuntimeEvent[] = [];

		await runSessionOnce({
			cwd: dir,
			sessionId: "serve-once-test",
			createAgentSession: async () => ({ session: new FakePiSession() }),
			onEvent: (event) => {
				events.push(event);
			},
		});

		expect(
			events.some(
				(event) =>
					event.kind === "session_event" &&
					event.event.type === "session_started",
			),
		).toBe(true);
	});
});
