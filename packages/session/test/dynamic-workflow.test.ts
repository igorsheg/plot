import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	dynamicWorkflowOutDir,
	validateDynamicWorkflowBundle,
} from "../src/dynamic-workflow.js";

const tempDirs: string[] = [];

describe("dynamic workflow validation", () => {
	test("uses Plot settings for the default dynamic output root", () => {
		expect(
			dynamicWorkflowOutDir({
				cwd: "/repo",
				goal: "Scan red CI builds!",
				settings: { dynamic: { outDir: "ops/workflows" } },
			}),
		).toBe("/repo/ops/workflows/scan-red-ci-builds");
	});

	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("reports when the forge agent never wrote a bundle", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-missing-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(false);
		expect(validation.errors).toEqual([
			"generated WORKFLOW.md was not written; the forge Agent Run must call write_dynamic_workflow_bundle",
		]);
	});

	test("rejects generated extensions with ignored tools and swallowed discovery failures", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-quality-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });
		await writeFile(
			join(outDir, "WORKFLOW.md"),
			[
				"---",
				"extension:",
				"  source: ./workflow.extension.ts",
				"---",
				"Registered tool available: `load_context`.",
				"",
			].join("\n"),
		);
		await writeFile(
			join(outDir, "workflow.extension.ts"),
			[
				'import { definePlotExtension, defineTool } from "plot-ai/sdk";',
				"const loadContext = defineTool({ name: 'load_context', parameters: { type: 'object', properties: {} }, execute: async () => ({ content: [] }) });",
				"export default definePlotExtension({",
				'	id: "bad-quality",',
				"	tools: [loadContext],",
				"	create() {",
				"		return { async discover() {",
				"			try { await (globalThis as any).Bun.file('packages').streamDirectory(); } catch { return []; }",
				"			return [];",
				"		} };",
				"	},",
				"});",
				"",
			].join("\n"),
		);

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(false);
		expect(validation.errors).toContain(
			"extension declares a top-level tools property; call registerTool(...) inside create() instead",
		);
		expect(validation.errors).toContain(
			"extension defines tools but never registers them with registerTool(...) inside create()",
		);
		expect(validation.errors).toContain(
			"extension uses unsupported streamDirectory(); use node:fs/promises readdir",
		);
		expect(validation.errors).toContain(
			"extension swallows discovery errors by returning []; let discovery fail or handle empty sources explicitly",
		);
	});

	test("rejects prompts that advertise unregistered tools", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-tool-prompt-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });
		await writeFile(
			join(outDir, "WORKFLOW.md"),
			[
				"---",
				"extension:",
				"  source: ./workflow.extension.ts",
				"---",
				"Registered tool available: `load_context`.",
				"",
			].join("\n"),
		);
		await writeFile(
			join(outDir, "workflow.extension.ts"),
			[
				'import { definePlotExtension } from "plot-ai/sdk";',
				"export default definePlotExtension({",
				'	id: "missing-tool",',
				"	create({ work }) {",
				"		return { discover: () => [work({ id: 'one', title: 'One' })] };",
				"	},",
				"});",
				"",
			].join("\n"),
		);

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(false);
		expect(validation.errors).toContain(
			"workflow prompt mentions registered tool `load_context` but extension registered no tools",
		);
	});

	test("rejects workflows that do not render discovered Work Item context", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-context-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });
		await writeFile(
			join(outDir, "WORKFLOW.md"),
			[
				"---",
				"extension:",
				"  source: ./workflow.extension.ts",
				"---",
				"Use the Work Item context to do the work.",
				"",
			].join("\n"),
		);
		await writeFile(
			join(outDir, "workflow.extension.ts"),
			[
				'import { definePlotExtension } from "plot-ai/sdk";',
				"export default definePlotExtension({",
				'	id: "missing-context-render",',
				"	create({ work }) {",
				"		return { discover: () => [work({ id: 'one', title: 'One', context: { packagePath: 'packages/one' } })] };",
				"	},",
				"});",
				"",
			].join("\n"),
		);

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(false);
		expect(validation.errors).toContain(
			"workflow prompt does not render Work Item context; include template variables such as {{ work.title }} or context fields, or use a work-bound tool factory",
		);
	});

	test("warns when validation discovers no work", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-empty-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });
		await writeFile(
			join(outDir, "WORKFLOW.md"),
			"---\nextension:\n  source: ./workflow.extension.ts\n---\nNo current work.\n",
		);
		await writeFile(
			join(outDir, "workflow.extension.ts"),
			[
				'import { definePlotExtension } from "plot-ai/sdk";',
				"export default definePlotExtension({ id: 'empty', create: () => ({ discover: () => [] }) });",
				"",
			].join("\n"),
		);

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(true);
		expect(validation.warnings).toContain(
			"extension discovered no work during validation; check discovery inputs if that is unexpected",
		);
	});

	test("rejects generated extensions that bypass Plot scheduling", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-dynamic-validation-"));
		tempDirs.push(cwd);
		const outDir = join(cwd, "workflow");
		await mkdir(outDir, { recursive: true });
		await writeFile(
			join(outDir, "WORKFLOW.md"),
			"---\nextension:\n  source: ./workflow.extension.ts\n---\nDo work.\n",
		);
		await writeFile(
			join(outDir, "workflow.extension.ts"),
			[
				'import { createAgentSession } from "@earendil-works/pi-coding-agent";',
				'import { definePlotExtension } from "plot-ai/sdk";',
				"export default definePlotExtension({",
				'\tid: "bad",',
				"\tcreate() { void createAgentSession; return { discover: () => [] }; },",
				"});",
				"",
			].join("\n"),
		);

		const validation = await validateDynamicWorkflowBundle({ cwd, outDir });

		expect(validation.ok).toBe(false);
		expect(validation.errors).toContain(
			"extension imports an unsupported agent-session SDK directly",
		);
		expect(validation.errors).toContain(
			"extension creates agent sessions directly",
		);
	});
});
