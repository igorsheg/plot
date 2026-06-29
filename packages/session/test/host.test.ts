import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { createProtocolSessionHost, createSessionHost } from "../src/host.js";
import type { PiAgentSessionPort } from "../src/pi-runner.js";

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

	test("wires workflow, paths, runtime, pi runner, and event log", async () => {
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
		let createOptions: CreateAgentSessionOptions | undefined;
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
		await host.shutdown();
		const log = await host.eventLog.readAll();

		expect(host.metadata).toMatchObject({
			workflowName: "host-test",
			cwd,
			cwdName: cwd.split("/").at(-1),
		});
		expect(createOptions).toMatchObject({ cwd, noTools: "all" });
		expect(session.prompts).toEqual(["Hello host-test"]);
		expect(log.records.some((record) => record.kind === "agent_event")).toBe(
			true,
		);
		expect(session.disposed).toBe(true);
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
			protocol: "plot.session.v2",
			kind: "request",
			id: "after-close",
			command: "ping",
		});

		expect(welcome).toMatchObject({
			kind: "welcome",
			sessionId: "session-protocol-host-test",
		});
		expect(accepted).toBe(false);
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
		await host.shutdown();
		const snapshot = await host.runtime.snapshot();

		expect(session.disposed).toBe(true);
		expect(snapshot.running).toEqual({});
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
