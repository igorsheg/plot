import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { createSessionHost } from "../src/host.js";
import { sessionEventLogPath } from "../src/paths.js";
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
	}

	dispose(): void {
		this.disposed = true;
	}
}

const tempDirs: string[] = [];
const sharedWorkflow = (name: string, item: string, message: string) => `---
name: ${name}
agent:
  provider: test
  model: fake
  maxTurns: 1
extension:
  source: ./extension.ts
  config:
    item: ${item}
    message: ${message}
---
{{ message }}
`;

const makeWorkflow = async (input?: { shutdownMarker?: string }) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-host-"));
	tempDirs.push(dir);
	await writeFile(
		join(dir, "extension.ts"),
		`import { writeFile } from "node:fs/promises";
export default {
  id: "host-test",
  create: () => ({
    discover: () => [{ id: "one", context: { message: "hello" } }],
    ${
			input?.shutdownMarker === undefined
				? ""
				: `shutdown: () => writeFile(${JSON.stringify(input.shutdownMarker)}, "done"),`
		}
  }),
};
`,
	);
	await writeFile(
		join(dir, "WORKFLOW.md"),
		`---
name: host-test
extension:
  source: ./extension.ts
agent:
  provider: test
  model: fake
  maxTurns: 1
  noTools: true
---
{{ message }}
`,
	);
	return dir;
};

describe("host composition", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("session event paths reject unsafe ids", () => {
		expect(() => sessionEventLogPath("/tmp/sessions", "../escape")).toThrow(
			"session id",
		);
		expect(() => sessionEventLogPath("/tmp/sessions", "nested/id")).toThrow(
			"session id",
		);
	});

	test("wires a Source-driven Workflow into continuous execution", async () => {
		const cwd = await makeWorkflow();
		const session = new FakePiSession();
		const host = await createSessionHost({
			cwd,
			sessionId: "host-test",
			createAgentSession: async () => ({ session }),
		});

		await host.runtime.start();
		await host.runtime.tickOnce();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await host.shutdown();

		expect(host.metadata).toMatchObject({ workflowName: "host-test", cwd });
		expect(session.prompts).toEqual(["hello"]);
		expect(session.disposed).toBe(true);
		expect(
			await readFile(
				sessionEventLogPath(host.paths.sessionDir, "host-test"),
				"utf8",
			),
		).toContain("session_started");
	});

	test("one Extension serves differently configured Workflows concurrently", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-host-shared-"));
		tempDirs.push(cwd);
		await writeFile(
			join(cwd, "extension.ts"),
			`export default {
  id: "shared",
  create: ({ config }) => ({
    discover: () => [{ id: config.item, context: { message: config.message } }],
  }),
};
`,
		);
		await Promise.all([
			writeFile(join(cwd, "acme.md"), sharedWorkflow("acme", "acme:1", "acme")),
			writeFile(join(cwd, "plot.md"), sharedWorkflow("plot", "plot:1", "plot")),
		]);
		const acmeSession = new FakePiSession();
		const plotSession = new FakePiSession();
		const [acme, plot] = await Promise.all([
			createSessionHost({
				cwd,
				workflowPath: "acme.md",
				sessionId: "acme",
				createAgentSession: async () => ({ session: acmeSession }),
			}),
			createSessionHost({
				cwd,
				workflowPath: "plot.md",
				sessionId: "plot",
				createAgentSession: async () => ({ session: plotSession }),
			}),
		]);

		await Promise.all([acme.runtime.start(), plot.runtime.start()]);
		await Promise.all([acme.runtime.tickOnce(), plot.runtime.tickOnce()]);
		await Bun.sleep(0);

		expect(acmeSession.prompts).toEqual(["acme"]);
		expect(plotSession.prompts).toEqual(["plot"]);
		await Promise.all([acme.shutdown(), plot.shutdown()]);
	});

	test("a running Session keeps its loaded Workflow until restart", async () => {
		const cwd = await makeWorkflow();
		const workflowPath = join(cwd, "WORKFLOW.md");
		const firstSession = new FakePiSession();
		const first = await createSessionHost({
			cwd,
			sessionId: "before-edit",
			createAgentSession: async () => ({ session: firstSession }),
		});
		await writeFile(
			workflowPath,
			`---
name: edited
extension:
  source: ./extension.ts
agent:
  provider: test
  model: fake
  maxTurns: 1
---
Edited {{ message }}
`,
		);

		await first.runtime.start();
		await first.runtime.tickOnce();
		await Bun.sleep(0);
		expect(firstSession.prompts).toEqual(["hello"]);
		await first.shutdown();

		const secondSession = new FakePiSession();
		const second = await createSessionHost({
			cwd,
			sessionId: "after-edit",
			createAgentSession: async () => ({ session: secondSession }),
		});
		await second.runtime.start();
		await second.runtime.tickOnce();
		await Bun.sleep(0);
		expect(secondSession.prompts).toEqual(["Edited hello"]);
		await second.shutdown();
	});

	test("shutdown closes the loaded Extension", async () => {
		const marker = join(tmpdir(), `plot-host-marker-${crypto.randomUUID()}`);
		const cwd = await makeWorkflow({ shutdownMarker: marker });
		const host = await createSessionHost({
			cwd,
			sessionId: "shutdown",
			createAgentSession: async () => ({ session: new FakePiSession() }),
		});
		await host.runtime.start();
		await host.shutdown();
		expect(await readFile(marker, "utf8")).toBe("done");
		await rm(marker, { force: true });
	});
});
