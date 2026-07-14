import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import {
	decodeSessionWorkerRecord,
	encodeSessionWorkerRecord,
	serveSessionWorker,
	type SessionWorkerCommand,
} from "../src/worker.js";
import type { PiAgentSessionPort } from "../src/pi-runner.js";

class FakeSession implements PiAgentSessionPort {
	subscribe(_listener: (event: AgentSessionEvent) => void): () => void {
		return () => {};
	}
	async prompt(_text: string, _options?: PromptOptions): Promise<void> {}
	dispose(): void {}
}

async function* commands(values: readonly SessionWorkerCommand[]) {
	for (const value of values) yield encodeSessionWorkerRecord(value);
}

test("private Session worker starts, reports state, and shuts down", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-worker-"));
	await writeFile(
		join(dir, "extension.ts"),
		`export default { id: "worker-test", create: () => ({ discover: () => [] }) };\n`,
	);
	await writeFile(
		join(dir, "WORKFLOW.md"),
		`---
name: worker-test
extension:
  source: ./extension.ts
agent:
  provider: test
  model: fake
---
Prompt
`,
	);
	const output: string[] = [];

	await serveSessionWorker({
		cwd: dir,
		workflowPath: join(dir, "WORKFLOW.md"),
		sessionId: "worker-test",
		createAgentSession: async () => ({ session: new FakeSession() }),
		stdin: commands([
			{ kind: "command", id: "start", action: "start" },
			{ kind: "command", id: "state", action: "state" },
			{ kind: "command", id: "stop", action: "shutdown" },
		]),
		writeLine: (line) => {
			output.push(line);
		},
	});

	const records = output.map((line) =>
		decodeSessionWorkerRecord(JSON.parse(line) as unknown),
	);
	expect(records[0]).toMatchObject({
		kind: "ready",
		sessionId: "worker-test",
		workflowName: "worker-test",
	});
	expect(records).toContainEqual(
		expect.objectContaining({ kind: "result", id: "start", ok: true }),
	);
	expect(records).toContainEqual(
		expect.objectContaining({ kind: "result", id: "state", ok: true }),
	);
	expect(records).toContainEqual(
		expect.objectContaining({ kind: "result", id: "stop", ok: true }),
	);
	await rm(dir, { recursive: true, force: true });
});

test("private Session worker stops when the protocol pipe breaks", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-worker-pipe-"));
	await writeFile(
		join(dir, "extension.ts"),
		`export default { id: "worker-pipe", create: () => ({ discover: () => [] }) };\n`,
	);
	await writeFile(
		join(dir, "WORKFLOW.md"),
		`---
name: worker-pipe
extension:
  source: ./extension.ts
agent:
  provider: test
  model: fake
---
Prompt
`,
	);
	const failure = Object.assign(new Error("broken pipe"), {
		code: "EPIPE",
		syscall: "write",
		fd: 3,
	});
	let writes = 0;
	try {
		await expect(
			serveSessionWorker({
				cwd: dir,
				workflowPath: join(dir, "WORKFLOW.md"),
				sessionId: "worker-pipe",
				createAgentSession: async () => ({ session: new FakeSession() }),
				stdin: commands([{ kind: "command", id: "start", action: "start" }]),
				writeLine: () => {
					writes += 1;
					if (writes > 1) throw failure;
				},
			}),
		).rejects.toBe(failure);
		expect(writes).toBeGreaterThan(1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("private Session worker reports startup failure on the protocol", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-worker-failure-"));
	await writeFile(join(dir, "WORKFLOW.md"), "No Extension.\n");
	const output: string[] = [];
	try {
		await serveSessionWorker({
			cwd: dir,
			workflowPath: join(dir, "WORKFLOW.md"),
			sessionId: "worker-failure",
			createAgentSession: async () => ({ session: new FakeSession() }),
			stdin: commands([]),
			writeLine: (line) => {
				output.push(line);
			},
		});
		const records = output.map((line) =>
			decodeSessionWorkerRecord(JSON.parse(line) as unknown),
		);
		expect(records).toEqual([
			expect.objectContaining({
				kind: "failure",
				error: expect.objectContaining({
					code: "workflow_invalid",
				}),
			}),
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
