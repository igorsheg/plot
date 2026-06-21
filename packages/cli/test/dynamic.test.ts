import { afterEach, describe, expect, test } from "bun:test";
import type {
	AgentSession,
	AgentSessionEventListener,
	CreateAgentSessionResult,
} from "@plot/session/agent-session-types";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	validateDynamicWorkflowBundle,
	writeDynamicWorkflowMetadata,
} from "@plot/session/dynamic-workflow";
import { writePlotFauxAgentFiles } from "@plot/session/testing/faux-agent-session";
import { runPlotCli } from "../src/cli.js";

const tempDirs: string[] = [];
const originalFauxApiKey = process.env["PLOT_FAUX_API_KEY"];

async function* chunks(values: readonly string[]) {
	for (const value of values) yield value;
}

const fakeResult = (session: AgentSession) =>
	({ session, extensionsResult: {} }) as unknown as CreateAgentSessionResult;

const writeValidBundle = async (outDir: string) => {
	await writeFile(
		join(outDir, "WORKFLOW.md"),
		[
			"---",
			"name: generated-red-ci",
			"extension:",
			"  source: ./workflow.extension.ts",
			"plot:",
			"  maxRunDurationMs: 300000",
			"agent:",
			"  maxTurns: 3",
			"---",
			"Investigate {{ work.title }}.",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(outDir, "workflow.extension.ts"),
		[
			'import { definePlotExtension } from "plot-ai/sdk";',
			"",
			"export default definePlotExtension({",
			'\tid: "generated-red-ci",',
			"\tcreate({ work }) {",
			"\t\treturn {",
			"\t\t\tasync discover() {",
			'\t\t\t\treturn [work({ id: "ci:red", title: "Red CI build" })];',
			"\t\t\t},",
			"\t\t};",
			"\t},",
			"});",
			"",
		].join("\n"),
		"utf8",
	);
};

const writeInvalidBundle = async (outDir: string) => {
	await writeFile(
		join(outDir, "WORKFLOW.md"),
		[
			"---",
			"name: bad-red-ci",
			"extension:",
			"  source: ./workflow.extension.ts",
			"---",
			"Registered tool available: `load_context`.",
			"",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(outDir, "workflow.extension.ts"),
		[
			'import { definePlotExtension, defineTool } from "plot-ai/sdk";',
			"const loadContext = defineTool({ name: 'load_context', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) });",
			"export default definePlotExtension({",
			'\tid: "bad-red-ci",',
			"\ttools: [loadContext],",
			"\tcreate() { return { discover: () => [] }; },",
			"});",
			"",
		].join("\n"),
		"utf8",
	);
};

const makeForgeSession = (outDir: string) => {
	const prompts: string[] = [];
	const session = {
		subscribe: (_next: AgentSessionEventListener) => () => undefined,
		prompt: async (prompt: string) => {
			prompts.push(prompt);
			await writeValidBundle(outDir);
		},
		dispose: () => undefined,
	} as unknown as AgentSession;
	return {
		createAgentSession: async () => fakeResult(session),
		promptText: () => prompts.at(-1) ?? "",
		prompts: () => prompts,
	};
};

const makeRepairingForgeSession = (outDir: string) => {
	const prompts: string[] = [];
	const session = {
		subscribe: (_next: AgentSessionEventListener) => () => undefined,
		prompt: async (prompt: string) => {
			prompts.push(prompt);
			if (prompts.length === 1) await writeInvalidBundle(outDir);
			else await writeValidBundle(outDir);
		},
		dispose: () => undefined,
	} as unknown as AgentSession;
	return {
		createAgentSession: async () => fakeResult(session),
		prompts: () => prompts,
	};
};

describe("plot dynamic", () => {
	afterEach(async () => {
		if (originalFauxApiKey === undefined)
			delete process.env["PLOT_FAUX_API_KEY"];
		else process.env["PLOT_FAUX_API_KEY"] = originalFauxApiKey;
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("repairs invalid generated bundles through the forge workflow", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-repair-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflows", "red-ci");
		const forge = makeRepairingForgeSession(outDir);
		const stdout: string[] = [];
		const stderr: string[] = [];

		await runPlotCli(
			[
				"dynamic",
				"scan red CI builds",
				"--cwd",
				cwd,
				"--out",
				"workflows/red-ci",
				"--log-level",
				"none",
			],
			{
				stdin: chunks([]),
				writeStdout: (line) => {
					stdout.push(line);
				},
				writeStderr: (line) => {
					stderr.push(line);
				},
				createAgentSession: forge.createAgentSession,
			},
		);

		expect(forge.prompts()).toHaveLength(2);
		expect(forge.prompts()[1]).toContain(
			"extension declares a top-level tools property",
		);
		expect(stdout.join("")).toContain("wrote workflows/red-ci/WORKFLOW.md");
		expect(stderr).toEqual([]);
		const metadata = JSON.parse(
			await readFile(join(outDir, "plot.dynamic.json"), "utf8"),
		) as { validation: { ok: boolean } };
		expect(metadata.validation.ok).toBe(true);
	});

	test("opens the forge workflow in the TUI", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-tui-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflows", "red-ci");
		const stdout: string[] = [];
		let tuiOptions: Record<string, unknown> | undefined;

		await runPlotCli(
			[
				"dynamic",
				"scan red CI builds",
				"--cwd",
				cwd,
				"--out",
				"workflows/red-ci",
				"--tui",
				"--log-level",
				"none",
			],
			{
				stdin: chunks([]),
				writeStdout: (line) => {
					stdout.push(line);
				},
				runTui: async (options) => {
					tuiOptions = options as Record<string, unknown>;
					await writeValidBundle(outDir);
					const validation = await validateDynamicWorkflowBundle({
						cwd,
						outDir,
					});
					await writeDynamicWorkflowMetadata({
						goal: "scan red CI builds",
						outDir,
						forgeSessionId: String(tuiOptions["sessionId"]),
						validation,
					});
				},
			},
		);

		expect(tuiOptions).toEqual(
			expect.objectContaining({ mode: "oneshot", lifetime: "server" }),
		);
		expect(String(tuiOptions?.["workflowPath"])).toContain("WORKFLOW.md");
		expect(stdout.join("")).toContain("opening TUI for dynamic-forge-");
		expect(stdout.join("")).toContain("wrote workflows/red-ci/WORKFLOW.md");
	});

	test("forges a workflow bundle and records validation metadata", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflows", "red-ci");
		process.env["PLOT_FAUX_API_KEY"] = "plot-faux-key";
		await writePlotFauxAgentFiles({ cwd });
		const forge = makeForgeSession(outDir);
		const stdout: string[] = [];
		const stderr: string[] = [];

		await runPlotCli(
			[
				"dynamic",
				"scan red CI builds",
				"--cwd",
				cwd,
				"--out",
				"workflows/red-ci",
				"--agent-dir",
				".plot/agent",
				"--log-level",
				"none",
			],
			{
				stdin: chunks([]),
				writeStdout: (line) => {
					stdout.push(line);
				},
				writeStderr: (line) => {
					stderr.push(line);
				},
				createAgentSession: forge.createAgentSession,
			},
		);

		expect(forge.promptText()).toContain("Dynamic Workflow Forge");
		expect(forge.promptText()).toContain("write_dynamic_workflow_bundle");
		expect(forge.promptText()).toContain(
			"Current configured Plot auth/model catalog",
		);
		expect(forge.promptText()).toContain('"availableModels"');
		expect(forge.promptText()).toContain('"provider": "plot-faux"');
		expect(forge.promptText()).toContain('"model": "faux-1"');
		expect(forge.promptText()).toContain(outDir);
		expect(stdout.join("")).toContain("wrote workflows/red-ci/WORKFLOW.md");
		expect(stderr).toEqual([]);
		expect(await readFile(join(outDir, "WORKFLOW.md"), "utf8")).toContain(
			"generated-red-ci",
		);
		const metadata = JSON.parse(
			await readFile(join(outDir, "plot.dynamic.json"), "utf8"),
		) as {
			validation: { ok: boolean };
			goal: string;
		};
		expect(metadata.goal).toBe("scan red CI builds");
		expect(metadata.validation.ok).toBe(true);
	});
});
