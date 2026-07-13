import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import { runPlotCli } from "../src/cli.js";
import { selectOptionId } from "../src/commands/auth.js";
import { checkWorkflow } from "../src/commands/check.js";

async function* emptyInput() {}

const session: SessionSummary = {
	id: "session-1",
	workflowKey: "/repo/WORKFLOW.md",
	workflowName: "review-acme",
	workflowPath: "/repo/WORKFLOW.md",
	projectPath: "/repo",
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: "/repo/.plot/sessions/session-1.jsonl",
	lastSequence: 0,
};

const fakeManager = (input?: {
	started?: boolean;
	stopped?: SessionSummary;
}): SessionManagerRuntime =>
	({
		start: async () => ({
			session,
			started: input?.started ?? true,
		}),
		find: async () => session,
		get: async () => session,
		stop: async () => input?.stopped,
		stopSession: async () => input?.stopped,
		list: async () => [session],
		events: async function* () {},
		tick: async () => {},
		pause: async () => {},
		resume: async () => {},
		interrupt: async () => true,
		startSourceAction: async () => ({ accepted: true }),
		cancelSourceAction: async () => true,
		observe: async () => true,
		shutdown: async () => {},
	}) satisfies SessionManagerRuntime;

const invoke = async (args: readonly string[], manager = fakeManager()) => {
	const stdout: string[] = [];
	const tui: unknown[] = [];
	await runPlotCli(args, {
		stdin: emptyInput(),
		writeStdout: (text) => {
			stdout.push(text);
		},
		sessionManager: manager,
		runTui: (options) => {
			tui.push(options);
		},
	});
	return { output: stdout.join(""), tui };
};

describe("plot CLI", () => {
	test("root help contains only the durable Workflow surface", async () => {
		const { output } = await invoke(["--help"]);
		expect(output).toContain("plot [workflow]");
		expect(output).toContain("plot start [workflow]");
		expect(output).toContain("plot stop [workflow]");
		expect(output).toContain("plot web");
		expect(output).toContain("plot check [workflow]");
		for (const removed of [
			"open",
			"run",
			"runs",
			"events",
			"api",
			"serve",
			"setup",
			"doctor",
			"config",
			"init",
		])
			expect(output).not.toContain(`plot ${removed}`);
	});

	test("root starts or gets a Session and attaches the TUI", async () => {
		const { tui } = await invoke(["WORKFLOW.md"]);
		expect(tui).toHaveLength(1);
		expect(tui[0]).toEqual(expect.objectContaining({ session }));
	});

	test("start reports whether it created the Session", async () => {
		expect(
			(await invoke(["start"], fakeManager({ started: true }))).output,
		).toBe("Started review-acme\n");
		expect(
			(await invoke(["start"], fakeManager({ started: false }))).output,
		).toBe("Already running review-acme\n");
	});

	test("stop is idempotent by Workflow", async () => {
		expect(
			(
				await invoke(
					["stop", "/repo/WORKFLOW.md"],
					fakeManager({ stopped: session }),
				)
			).output,
		).toBe("Stopped review-acme\n");
		expect(
			(await invoke(["stop", "/repo/WORKFLOW.md"], fakeManager())).output,
		).toContain("is not running");
	});

	test("unknown commands do not route to a Workflow", async () => {
		const { output, tui } = await invoke(["runns"]);
		expect(output).toContain("Unknown command: runns");
		expect(tui).toEqual([]);
	});

	test("check rejects an extensionless Workflow with the public diagnostic", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-check-"));
		await writeFile(join(cwd, "WORKFLOW.md"), "Do it.\n");
		try {
			await expect(checkWorkflow({ cwd })).rejects.toThrow(
				"WORKFLOW.md requires an extension with at least one Source.",
			);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("auth selection accepts ids, labels, numbers, and default", () => {
		const prompt = {
			message: "Choose",
			options: [
				{ id: "anthropic", label: "Anthropic" },
				{ id: "openai", label: "OpenAI (configured)" },
			],
		};
		expect(selectOptionId(prompt, "")).toBe("anthropic");
		expect(selectOptionId(prompt, "2")).toBe("openai");
		expect(selectOptionId(prompt, "openai")).toBe("openai");
		expect(selectOptionId(prompt, "OpenAI")).toBe("openai");
	});
});
