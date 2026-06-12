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
			paths,
			config: undefined,
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

	test("superseded version drains; the id-level claim defers the next version", async () => {
		let version = "sha-1";
		const interrupted: string[] = [];
		const firstStarted = deferred<void>();
		const secondStarted = deferred<void>();
		const releaseFirst = deferred<string>();
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
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
			run: async ({ work }) => {
				if (String(work.workKey).endsWith(":sha-1")) {
					firstStarted.resolve();
					return { output: await releaseFirst.promise };
				}
				secondStarted.resolve();
				return new Promise(() => {});
			},
		});

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		const first = await agent.tickOnce();
		await firstStarted.promise;
		// The run advances its own durable version (e.g. anchor marker edit).
		version = "sha-2";
		const second = await agent.tickOnce();
		// Superseded run is not interrupted and the new version does not start
		// in parallel: the work id is still claimed by the draining run.
		expect(second.completions).toHaveLength(0);
		expect(second.started).toHaveLength(0);
		expect(second.skipped).toEqual([]);
		releaseFirst.resolve("phase complete");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const third = await agent.tickOnce();
		await secondStarted.promise;
		const snapshot = await agent.snapshot();

		expect(first.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
			}),
		]);
		expect(third.completions).toContainEqual(
			expect.objectContaining({
				status: "succeeded",
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
				output: "phase complete",
			}),
		);
		expect(third.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-2",
				),
			}),
		]);
		expect(
			snapshot.running.has(
				workKey("extension:github-pr-reviewer:github:acme/web:pr:42:sha-2"),
			),
		).toBe(true);
		expect(interrupted).toEqual([]);
	});

	test("blocked work holds its claim: no dispatch, no interrupt, status fact", async () => {
		let blocked: string | false = false;
		const started = deferred<void>();
		const releaseRun = deferred<string>();
		let aborts = 0;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				discover: () => [
					{
						id: "github:acme/web:pr:7",
						version: "sha-1",
						title: "Review PR #7",
						...(blocked === false ? {} : { blocked }),
					},
				],
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async ({ signal }) => {
				started.resolve();
				signal.addEventListener(
					"abort",
					() => {
						aborts += 1;
					},
					{ once: true },
				);
				return { output: await releaseRun.promise };
			},
		});

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		await agent.tickOnce();
		await started.promise;
		// Work becomes blocked while an attempt is running: hold, don't kill.
		blocked = "waiting for author reply";
		const second = await agent.tickOnce();
		expect(second.completions).toHaveLength(0);
		expect(aborts).toBe(0);
		releaseRun.resolve("done");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const third = await agent.tickOnce();
		expect(third.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", output: "done" }),
		);
		// Still blocked: the work is not redispatched, and the named claim
		// status is visible in facts with its reason.
		const fourth = await agent.tickOnce();
		expect(fourth.started).toHaveLength(0);
		const snapshot = await agent.snapshot();
		expect(
			snapshot.facts.get(
				"extension.work_status:extension:github-pr-reviewer:github:acme/web:pr:7",
			),
		).toEqual({ status: "blocked", reason: "waiting for author reply" });
	});

	test("claim status facts track running and released transitions", async () => {
		let works: readonly { id: string; version: string }[] = [
			{ id: "github:acme/web:pr:9", version: "sha-1" },
		];
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: { discover: () => works },
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: () => new Promise(() => {}),
		});
		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		const factKey =
			"extension.work_status:extension:github-pr-reviewer:github:acme/web:pr:9";
		await agent.tickOnce();
		await agent.tickOnce();
		expect((await agent.snapshot()).facts.get(factKey)).toEqual({
			status: "running",
		});
		works = [];
		await agent.tickOnce();
		await agent.tickOnce();
		expect((await agent.snapshot()).facts.has(factKey)).toBe(false);
	});

	test("released work id interrupts the running attempt", async () => {
		let works: readonly { id: string; version: string; title: string }[] = [
			{ id: "github:acme/web:pr:42", version: "sha-1", title: "Review PR #42" },
		];
		const interrupted: string[] = [];
		const started = deferred<void>();
		const aborted = deferred<void>();
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				discover: () => works,
				interrupted: ({ work }) => {
					interrupted.push(`${work.id}:${work.version ?? "unversioned"}`);
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: ({ signal }) => {
				started.resolve();
				signal.addEventListener("abort", () => aborted.resolve(), {
					once: true,
				});
				return new Promise(() => {});
			},
		});

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		await agent.tickOnce();
		await started.promise;
		// Terminal state: the PR is closed/merged and discovery stops
		// returning the work id entirely.
		works = [];
		const second = await agent.tickOnce();
		await aborted.promise;
		// The interrupted-completion hook is invoked by the next reconcile.
		await agent.tickOnce();

		expect(second.completions).toContainEqual(
			expect.objectContaining({
				status: "interrupted",
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
				error: expect.stringContaining("no longer discovered"),
			}),
		);
		expect(interrupted).toEqual(["github:acme/web:pr:42:sha-1"]);
	});

	test("binds registered pi tools to the current Plot work", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: { token: "test-token" },
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
					},
				],
			},
			tools: [
				({ work, runId, config }) => ({
					name: "github_pr_comment",
					label: "Comment on PR",
					description: `Comment on ${work.id} during ${runId} with ${String((config as { token: string }).token)}.`,
					parameters: {
						type: "object",
						properties: { body: { type: "string" } },
						required: ["body"],
					},
					execute: async () => ({
						content: [{ type: "text", text: `commented on ${work.id}` }],
						details: { workId: work.id, runId },
					}),
				}),
			],
		});
		const runner: WorkRunner = {
			run: async (context) => {
				const create = await bundle.createOptions(context);
				expect(create.customTools).toHaveLength(1);
				expect(create.customTools[0]?.name).toBe("github_pr_comment");
				expect(create.customTools[0]?.description).toBe(
					"Comment on github:acme/web:pr:42 during run-0 with test-token.",
				);
				const result = await create.customTools[0]?.execute(
					"tool-1",
					{ body: "looks good" },
					undefined,
					undefined,
					undefined as never,
				);
				expect(result?.content).toEqual([
					{ type: "text", text: "commented on github:acme/web:pr:42" },
				]);
				return { output: "ok" };
			},
		};

		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });
		const first = await agent.tickOnce();

		expect(first.started).toHaveLength(1);
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

	test("passes pi-native subagent runner helpers into extension setup", async () => {
		const calls: string[] = [];
		const dir = await makeTempDir();
		const extensionPath = join(dir, "extension.ts");
		await writeFile(
			extensionPath,
			`export default {
  id: "subagent-sdk-test",
  create: async ({ runAgent, runAgents }) => {
    await runAgent({ prompt: "one" });
    await runAgents([{ prompt: "two" }, { prompt: "three" }], { concurrency: 2 });
    return { discover: () => [] };
  }
};
`,
		);
		await loadPlotExtensionRuntimeFromWorkflow({
			paths: { ...paths, cwd: dir },
			workflow: {
				...workflow,
				path: join(dir, "WORKFLOW.md"),
				runtime: { extension: { source: "./extension.ts" } },
			},
			agentRunner: {
				runAgent: async (options) => {
					calls.push(`one:${options.prompt}`);
					return { events: [] };
				},
				runAgents: async (runs, options) => {
					calls.push(
						`many:${runs.map((run) => run.prompt).join(",")}:${options?.concurrency ?? "default"}`,
					);
					return runs.map(() => ({ events: [] }));
				},
			},
		});

		expect(calls).toEqual(["one:one", "many:two,three:2"]);
	});

	test("loads extension-registered pi tool definitions from the public SDK", async () => {
		const dir = await makeTempDir();
		const extensionPath = join(dir, "extension.ts");
		await writeFile(
			extensionPath,
			`import { definePlotExtension, defineTool } from "plot-ai/sdk";
export default definePlotExtension({
  id: "tool-sdk-test",
  create: ({ registerTool }) => {
    registerTool(defineTool({
      name: "echo_plot_context",
      label: "Echo Plot Context",
      description: "Echoes Plot context.",
      parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"] },
      execute: async (_id, params) => ({ content: [{ type: "text", text: params.value }], details: {} })
    }));
    return { discover: () => [] };
  }
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

		expect(loaded.tools).toHaveLength(1);
		expect(loaded.tools[0]).toEqual(
			expect.objectContaining({ name: "echo_plot_context" }),
		);
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
