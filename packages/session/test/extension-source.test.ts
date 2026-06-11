import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import type { WorkRunner } from "@plot/agent/work-runner";
import { makePlotAgentLayer } from "@plot/agent/agent";
import { workKey } from "@plot/agent/model";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	makePlotExtensionSourceBundle,
} from "../src/extension-source.js";
import type { PlotPaths } from "../src/plot-paths.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const deferred = <A>() => {
	let resolve!: (value: A) => void;
	const promise = new Promise<A>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};

const tempDirs: string[] = [];
const makeTempDir = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-extension-source-"));
	tempDirs.push(dir);
	return dir;
};

const workflow: WorkflowDefinition = {
	config: { name: "extension-test" },
	runtime: {},
	prompt: "Review {{ repo }} #{{ prNumber }} with {{ workflow.name }}.",
};

const paths: PlotPaths = {
	cwd: "/repo",
	plotDir: "/repo/.plot",
	agentDir: "/repo/.plot/agent",
	sessionDir: "/repo/.plot/sessions",
	skillsDir: "/repo/.plot/skills",
	extensionsDir: "/repo/.plot/extensions",
	promptsDir: "/repo/.plot/prompts",
};

describe("Plot extension source adapter", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) =>
					import("node:fs/promises").then(({ rm }) =>
						rm(dir, { recursive: true, force: true }),
					),
				),
		);
	});

	test("adapts discovery and lifecycle hooks into Plot WorkSource semantics", async () => {
		const lifecycle: string[] = [];
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				discover: () => [
					{
						id: "github:acme/web:pr:42",
						version: "sha-1",
						title: "Review PR #42",
						context: { repo: "acme/web", prNumber: 42 },
					},
				],
				started: ({ work, runId }) => {
					lifecycle.push(`started:${work.id}:${runId}`);
				},
				completed: ({ work, output }) => {
					lifecycle.push(`completed:${work.id}:${String(output)}`);
				},
				shutdown: () => {
					lifecycle.push("shutdown");
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: ({ work }) => {
				expect(work.templateContext).toEqual(
					expect.objectContaining({
						workflow: { name: "extension-test" },
						repo: "acme/web",
						prNumber: 42,
					}),
				);
				return { output: "ok" };
			},
		});

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		const first = await agent.tickOnce();
		await Promise.resolve();
		const second = await agent.tickOnce();
		const third = await agent.tickOnce();
		await bundle.shutdown();
		const result = { first, second, third };

		expect(result.first.started).toHaveLength(1);
		expect(result.second.completions).toHaveLength(1);
		expect(result.third.started).toHaveLength(0);
		expect(lifecycle).toEqual([
			"started:github:acme/web:pr:42:run-0",
			"completed:github:acme/web:pr:42:ok",
			"shutdown",
		]);
	});

	test("interrupts stale running extension work when discovery changes version", async () => {
		let version = "sha-1";
		const interrupted: string[] = [];
		const firstStarted = deferred<void>();
		const secondStarted = deferred<void>();
		const firstInterrupted = deferred<void>();
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				discover: () => [
					{
						id: "github:acme/web:pr:42",
						version,
						title: `Review PR #42 at ${version}`,
					},
				],
				interrupted: ({ work }) => {
					interrupted.push(`${work.id}:${work.version ?? "unversioned"}`);
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: ({ work, signal }) => {
				if (String(work.workKey).endsWith(":sha-1")) {
					firstStarted.resolve();
					signal.addEventListener("abort", () => firstInterrupted.resolve(), {
						once: true,
					});
					return new Promise(() => {});
				}
				secondStarted.resolve();
				return new Promise(() => {});
			},
		});

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		const first = await agent.tickOnce();
		await firstStarted.promise;
		version = "sha-2";
		const second = await agent.tickOnce();
		await firstInterrupted.promise;
		await secondStarted.promise;
		const third = await agent.tickOnce();
		const snapshot = await agent.snapshot();
		const result = { first, second, third, snapshot };

		expect(result.first.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
			}),
		]);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({
				status: "interrupted",
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
			}),
		);
		expect(result.second.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-2",
				),
			}),
		]);
		expect(
			result.snapshot.running.has(
				workKey("extension:github-pr-reviewer:github:acme/web:pr:42:sha-1"),
			),
		).toBe(false);
		expect(
			result.snapshot.running.has(
				workKey("extension:github-pr-reviewer:github:acme/web:pr:42:sha-2"),
			),
		).toBe(true);
		expect(interrupted).toEqual(["github:acme/web:pr:42:sha-1"]);
	});

	test("loads a local extension module that imports the public SDK", async () => {
		const dir = await makeTempDir();
		const extensionPath = join(dir, "extension.ts");
		await writeFile(
			extensionPath,
			`import { definePlotExtension } from "plot-ai/sdk";
export default definePlotExtension({
  id: "public-sdk-test",
  create: ({ work }) => ({
    discover: () => [work({ id: "work:from-sdk", version: "v1" })]
  })
});
`,
		);
		const loaded = await loadPlotExtensionRuntimeFromWorkflow({
			paths: { ...paths, cwd: dir },
			workflow: {
				...workflow,
				path: join(dir, "WORKFLOW.md"),
				runtime: { extension: { source: "./extension.ts" } },
			},
		});

		expect(loaded.extension.id).toBe("public-sdk-test");
		expect(await loaded.runtime.discover()).toEqual([
			{ id: "work:from-sdk", version: "v1" },
		]);
	});

	test("loads a local extension module from WORKFLOW.md config", async () => {
		const dir = await makeTempDir();
		const extensionPath = join(dir, "extension.ts");
		await writeFile(
			extensionPath,
			`export default {\n  id: "local-test",\n  parseConfig: (input) => input,\n  create: ({ config, work }) => ({\n    discover: () => [work({ id: config.id, version: "v1", context: { value: 1 } })]\n  })\n};\n`,
		);
		const loaded = await loadPlotExtensionRuntimeFromWorkflow({
			paths: { ...paths, cwd: dir },
			workflow: {
				...workflow,
				path: join(dir, "WORKFLOW.md"),
				runtime: {
					extension: { source: "./extension.ts", config: { id: "work:1" } },
				},
			},
		});

		expect(loaded.extension.id).toBe("local-test");
		expect(await loaded.runtime.discover()).toEqual([
			{ id: "work:1", version: "v1", context: { value: 1 } },
		]);
	});
});
