import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiAgentSessionPort } from "../src/pi-runner.js";
import {
	decodeServerRecordLine,
	defaultProtocolLimits,
	sessionProtocolVersion,
} from "../src/protocol.js";
import { ExtensionSetupRequiredError } from "../src/readiness.js";
import type { RuntimeEvent } from "../src/runtime.js";
import { runSessionOnce, serveSessionStdio } from "../src/serve.js";

class FakePiSession implements PiAgentSessionPort {
	readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	disposed = false;

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(_text: string, _options?: PromptOptions): Promise<void> {}

	dispose(): void {
		this.disposed = true;
	}
}

class DelayedPiSession extends FakePiSession {
	completed = false;

	override async prompt(
		_text: string,
		_options?: PromptOptions,
	): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 10));
		this.completed = true;
	}
}

const tempDirs: string[] = [];

async function* chunks(values: readonly (string | Uint8Array)[]) {
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
				method: "ping",
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

	test("serveSessionStdio preserves split UTF-8 and reports malformed lines", async () => {
		const dir = await makeWorkflowDir();
		const lines: string[] = [];
		const input = new TextEncoder().encode(
			`{bad json}\n${JSON.stringify({
				protocol: sessionProtocolVersion,
				kind: "request",
				id: "ping-💥",
				method: "ping",
			})}`,
		);

		await serveSessionStdio({
			cwd: dir,
			sessionId: "serve-boundaries",
			stdin: chunks([...input].map((byte) => Uint8Array.of(byte))),
			writeLine: (line) => {
				lines.push(line);
			},
		});

		const records = lines.map((line) => decodeServerRecordLine(line));
		expect(records).toContainEqual(
			expect.objectContaining({
				kind: "response",
				ok: false,
				error: expect.objectContaining({ code: "parse_error" }),
			}),
		);
		expect(records).toContainEqual(
			expect.objectContaining({
				kind: "response",
				id: "ping-💥",
				ok: true,
			}),
		);
	});

	test("serveSessionStdio bounds unterminated input", async () => {
		const dir = await makeWorkflowDir();
		const lines: string[] = [];

		await serveSessionStdio({
			cwd: dir,
			sessionId: "serve-oversized",
			stdin: chunks(["x".repeat(defaultProtocolLimits.maxInputLineBytes + 1)]),
			writeLine: (line) => {
				lines.push(line);
			},
		});

		const records = lines.map((line) => decodeServerRecordLine(line));
		expect(records).toContainEqual(
			expect.objectContaining({
				kind: "response",
				ok: false,
				error: expect.objectContaining({ code: "payload_too_large" }),
			}),
		);
	});

	test("serveSessionStdio shuts down host cleanup when stdin ends", async () => {
		const dir = await makeWorkflowDir();
		const marker = join(dir, "shutdown.txt");
		await writeFile(
			join(dir, "extension.ts"),
			`import { appendFile } from "node:fs/promises";
export default {
  id: "stdio-shutdown-hook",
  create: () => ({
    discover: () => [],
    shutdown: async () => appendFile(${JSON.stringify(marker)}, "x"),
  }),
};
`,
		);
		await writeFile(
			join(dir, "WORKFLOW.md"),
			`---
extension:
  source: ./extension.ts
---
Prompt
`,
		);

		await serveSessionStdio({
			cwd: dir,
			sessionId: "serve-stdin-end-shutdown",
			stdin: chunks([]),
			writeLine: () => {},
		});

		expect(await readFile(marker, "utf8")).toBe("x");
	});

	test("runSessionOnce fails deterministically when extension setup is required", async () => {
		const dir = await makeWorkflowDir();
		await writeFile(
			join(dir, "extension.ts"),
			`export default {
  id: "setup-required",
  create: () => ({
    requirements: [{
      id: "auth",
      label: "Authentication",
      check: () => ({ status: "action-required", message: "Connect", actions: [] })
    }],
    discover: () => { throw new Error("discover must not run"); }
  })
};
`,
		);
		await writeFile(
			join(dir, "WORKFLOW.md"),
			"---\nextension:\n  source: ./extension.ts\n---\nPrompt\n",
		);

		await expect(
			runSessionOnce({ cwd: dir, sessionId: "setup-required" }),
		).rejects.toBeInstanceOf(ExtensionSetupRequiredError);
	});

	test("runSessionOnce waits for the agent attempt to succeed", async () => {
		const dir = await makeWorkflowDir();
		const events: RuntimeEvent[] = [];
		const session = new DelayedPiSession();

		await runSessionOnce({
			cwd: dir,
			sessionId: "serve-once-test",
			createAgentSession: async () => ({ session }),
			onEvent: (event) => {
				events.push(event);
			},
		});

		expect(session.completed).toBe(true);
		expect(session.disposed).toBe(true);
		expect(
			events.some(
				(event) =>
					event.kind === "session_event" &&
					event.event.type === "attempt_completed" &&
					event.event.completion.status === "succeeded",
			),
		).toBe(true);
		expect(
			events.some(
				(event) =>
					event.kind === "session_event" &&
					event.event.type === "attempt_completed" &&
					event.event.completion.status === "interrupted",
			),
		).toBe(false);
	});
});
