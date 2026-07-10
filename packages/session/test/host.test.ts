import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { makeCreatePiAgentSession } from "../src/pi-session.js";
import { createProtocolSessionHost, createSessionHost } from "../src/host.js";
import { resolveSessionPaths, sessionEventLogPath } from "../src/paths.js";
import type {
	PiAgentSessionPort,
	PiAgentSessionRunOptions,
} from "../src/pi-runner.js";
import { parseWorkflowText } from "../src/workflow.js";
import { sessionProtocolVersion } from "../src/protocol.js";

const waitForRuntimeEvent = async <A>(
	iterable: AsyncIterable<A>,
	predicate: (item: A) => boolean,
): Promise<A> => {
	const iterator = iterable[Symbol.asyncIterator]();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const found = (async () => {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop -- helper polls until the requested event arrives.
				const next = await iterator.next();
				if (next.done) break;
				if (predicate(next.value)) return next.value;
			}
			throw new Error("event stream ended before matching event");
		})();
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(() => reject(new Error("timed out")), 1000);
		});
		return await Promise.race([found, timedOut]);
	} finally {
		if (timeout) clearTimeout(timeout);
		await iterator.return?.();
	}
};

class FakePiSession implements PiAgentSessionPort {
	readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	readonly prompts: string[] = [];
	disposed = false;

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string, _options?: PromptOptions): Promise<void> {
		this.prompts.push(text);
		for (const listener of this.listeners)
			listener({ type: "queue_update", steering: [], followUp: [] });
	}

	dispose(): void {
		this.disposed = true;
	}
}

class BlockingPiSession extends FakePiSession {
	started!: () => void;
	readonly startedPromise = new Promise<void>((resolve) => {
		this.started = resolve;
	});

	override async prompt(text: string, options?: PromptOptions): Promise<void> {
		this.prompts.push(text);
		this.started();
		await new Promise<void>(() => {
			void options;
		});
	}
}

const tempDirs: string[] = [];
const makeTempDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-host-"));
	tempDirs.push(dir);
	return dir;
};

describe("host composition", () => {
	test("session event paths reject unsafe session ids", () => {
		expect(() => sessionEventLogPath("/tmp/sessions", "../escape")).toThrow(
			"session id",
		);
		expect(() => sessionEventLogPath("/tmp/sessions", "nested/id")).toThrow(
			"session id",
		);
	});

	afterEach(async () => {
		const { rm } = await import("node:fs/promises");
		await Promise.all(
			tempDirs.splice(0).map((dir) =>
				rm(dir, {
					recursive: true,
					force: true,
				}),
			),
		);
	});

	test("wires workflow, paths, runtime, and pi runner", async () => {
		const cwd = await makeTempDir();
		await writeFile(
			join(cwd, "WORKFLOW.md"),
			`---
name: host-test
plot:
  queueCapacity: 3
agent:
  maxTurns: 1
  noTools: true
---
Hello {{ workflow.name }}
`,
		);
		const session = new FakePiSession();
		let createOptions: PiAgentSessionRunOptions | undefined;
		const host = await createSessionHost({
			cwd,
			sessionId: "host-test",
			createAgentSession: async (options) => {
				createOptions = options;
				return { session };
			},
		});

		await host.runtime.start();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await host.runtime.tickOnce();
		const state = await host.runtime.state();
		await host.shutdown();

		expect(host.metadata).toMatchObject({
			workflowName: "host-test",
			cwd,
			cwdName: cwd.split("/").at(-1),
		});
		expect(state.sessionFile).toBe(
			join(host.paths.sessionDir, "host-test.jsonl"),
		);
		expect(createOptions).toBeUndefined();
		expect(session.prompts).toEqual(["Hello host-test"]);
		expect(session.disposed).toBe(true);
	});

	test("passes only extension per-run options to createAgentSession", async () => {
		const cwd = await makeTempDir();
		const workCwd = join(cwd, "work");
		await writeFile(
			join(cwd, "extension.ts"),
			`export default {
  id: "per-run",
  create: ({ registerTool }) => {
    registerTool({
      name: "demo_tool",
      description: "Demo tool",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: [{ type: "text", text: "ok" }] })
    });
    return { discover: () => [{ id: "work", workspace: ${JSON.stringify(workCwd)} }] };
  }
};
`,
		);
		await writeFile(
			join(cwd, "WORKFLOW.md"),
			`---
extension:
  source: ./extension.ts
---
Do it
`,
		);
		const session = new FakePiSession();
		let createOptions: PiAgentSessionRunOptions | undefined;
		let created!: () => void;
		const createdPromise = new Promise<void>((resolve) => {
			created = resolve;
		});
		const host = await createSessionHost({
			cwd,
			sessionId: "host-extension-options",
			createAgentSession: async (options) => {
				createOptions = options;
				created();
				return { session };
			},
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const tickUntilCreated = async (): Promise<void> => {
			if (createOptions !== undefined) return;
			await host.runtime.tickOnce();
			await new Promise((resolve) => setTimeout(resolve, 0));
			return tickUntilCreated();
		};
		try {
			await host.runtime.start();
			await Promise.race([
				createdPromise,
				tickUntilCreated(),
				new Promise<never>((_, reject) => {
					timeout = setTimeout(
						() => reject(new Error("agent session was not created")),
						1000,
					);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			await host.shutdown();
		}

		expect(createOptions?.cwd).toBe(workCwd);
		expect(createOptions?.customTools?.map((tool) => tool.name)).toEqual([
			"demo_tool",
		]);
		expect(Object.keys(createOptions ?? {}).toSorted()).toEqual([
			"customTools",
			"cwd",
		]);
	});

	test("protocol host owns protocol close and runtime shutdown", async () => {
		const cwd = await makeTempDir();
		await writeFile(join(cwd, "WORKFLOW.md"), "Protocol host");
		const host = await createProtocolSessionHost({
			cwd,
			sessionId: "session-protocol-host-test",
			createAgentSession: async () => ({ session: new FakePiSession() }),
		});

		const welcome = await host.protocol.welcome();
		await host.shutdown();
		const accepted = await host.protocol.submit({
			protocol: sessionProtocolVersion,
			kind: "request",
			id: "after-close",
			method: "ping",
		});

		expect(welcome).toMatchObject({
			kind: "welcome",
			sessionId: "session-protocol-host-test",
		});
		expect(accepted).toBe(false);
	});

	test("protocol session.shutdown runs host-owned extension cleanup once", async () => {
		const cwd = await makeTempDir();
		const marker = join(cwd, "shutdown.txt");
		await writeFile(
			join(cwd, "extension.ts"),
			`import { appendFile } from "node:fs/promises";
export default {
  id: "shutdown-hook",
  create: () => ({
    discover: () => [],
    shutdown: async () => appendFile(${JSON.stringify(marker)}, "x"),
  }),
};
`,
		);
		await writeFile(
			join(cwd, "WORKFLOW.md"),
			`---
extension:
  source: ./extension.ts
---
Prompt
`,
		);
		const host = await createProtocolSessionHost({
			cwd,
			sessionId: "session-protocol-shutdown-hook",
		});

		const accepted = await host.protocol.submit({
			protocol: sessionProtocolVersion,
			kind: "request",
			id: "shutdown",
			method: "session.shutdown",
		});
		await host.shutdown();

		expect(accepted).toBe(true);
		expect(await readFile(marker, "utf8")).toBe("x");
	});

	test("shutdown interrupts an active agent run", async () => {
		const cwd = await makeTempDir();
		await writeFile(join(cwd, "WORKFLOW.md"), "Long running workflow");
		const session = new BlockingPiSession();
		const host = await createSessionHost({
			cwd,
			sessionId: "session-active-shutdown",
			createAgentSession: async () => ({ session }),
		});

		await host.runtime.start();
		await host.runtime.tickOnce();
		await session.startedPromise;
		const completed = waitForRuntimeEvent(
			host.runtime.events(),
			(record) =>
				record.kind === "session_event" &&
				record.event.type === "attempt_completed",
		);
		await host.shutdown();

		expect(session.disposed).toBe(true);
		expect(await completed).toMatchObject({
			kind: "session_event",
			event: {
				type: "attempt_completed",
				completion: { status: "interrupted" },
			},
		});
	});

	test("agent settings parse errors name the bad file", async () => {
		const cwd = await makeTempDir();
		const plotDir = join(cwd, ".plot");
		const agentDir = join(plotDir, "agent");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(plotDir, "settings.json"),
			'{"defaultProvider":"x",}\n',
		);
		const createAgentSession = makeCreatePiAgentSession({
			workflow: parseWorkflowText("Review"),
			paths: resolveSessionPaths({ cwd, agentDir }),
		});

		await expect(createAgentSession()).rejects.toThrow(
			join(plotDir, "settings.json"),
		);
	});

	test("agent settings validate field types", async () => {
		const cwd = await makeTempDir();
		const plotDir = join(cwd, ".plot");
		await mkdir(plotDir, { recursive: true });
		await writeFile(join(plotDir, "settings.json"), '{"defaultModel":42}\n');
		const createAgentSession = makeCreatePiAgentSession({
			workflow: parseWorkflowText("Review"),
			paths: resolveSessionPaths({ cwd }),
		});

		await expect(createAgentSession()).rejects.toThrow("defaultModel");
	});

	test("runtime API keys require a provider", async () => {
		const cwd = await makeTempDir();
		const createAgentSession = makeCreatePiAgentSession({
			workflow: parseWorkflowText("Review"),
			paths: resolveSessionPaths({ cwd }),
			overrides: { apiKey: "secret" },
		});

		await expect(createAgentSession()).rejects.toThrow("--api-key requires");
	});

	test("shutdown still closes extensions and protocol after runtime failure", async () => {
		const cwd = await makeTempDir();
		const marker = join(cwd, "shutdown-after-error.txt");
		await writeFile(
			join(cwd, "extension.ts"),
			`import { writeFile } from "node:fs/promises";
export default {
  id: "shutdown-error",
  create: () => ({
    discover: () => [],
    shutdown: async () => writeFile(${JSON.stringify(marker)}, "done")
  })
};
`,
		);
		await writeFile(
			join(cwd, "WORKFLOW.md"),
			`---
extension:
  source: ./extension.ts
---
Prompt
`,
		);
		const host = await createProtocolSessionHost({
			cwd,
			sessionId: "session-shutdown-error",
		});
		(host.runtime as { shutdown: () => Promise<boolean> }).shutdown =
			async () => {
				throw new Error("runtime shutdown failed");
			};

		await expect(host.shutdown()).rejects.toThrow("runtime shutdown failed");

		expect(await readFile(marker, "utf8")).toBe("done");
		expect(
			await host.protocol.submit({
				protocol: sessionProtocolVersion,
				kind: "request",
				id: "closed",
				method: "ping",
			}),
		).toBe(false);
	});

	test("shutdown runs runtime before extension cleanup", async () => {
		const cwd = await makeTempDir();
		await mkdir(join(cwd, "state"));
		await writeFile(
			join(cwd, "extension.ts"),
			`import { writeFile } from "node:fs/promises";
export default {
  id: "shutdown-test",
  create: () => ({
    discover: () => [],
    shutdown: async () => writeFile(${JSON.stringify(join(cwd, "state", "shutdown.txt"))}, "done")
  })
};
`,
		);
		await writeFile(
			join(cwd, "WORKFLOW.md"),
			`---
extension:
  source: ./extension.ts
---
Extension workflow
`,
		);
		const host = await createSessionHost({
			cwd,
			sessionId: "session-extension",
		});

		await host.shutdown();

		expect(await readFile(join(cwd, "state", "shutdown.txt"), "utf8")).toBe(
			"done",
		);
	});
});
