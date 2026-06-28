import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makePlotAgentLayer } from "@plot/agent/agent";
import { workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	makePlotExtensionSourceBundle,
} from "../src/extension-source.js";
import type { SessionPaths } from "../src/paths.js";
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
	const dir = await mkdtemp(join(tmpdir(), "plot-extension-"));
	tempDirs.push(dir);
	return dir;
};

const workflow: WorkflowDefinition = {
	config: { name: "extension-test" },
	runtime: {},
	prompt: "Review {{ repo }} #{{ prNumber }} with {{ workflow.name }}.",
};

const paths: SessionPaths = {
	cwd: "/repo",
	plotDir: "/repo/.plot",
	agentDir: "/repo/.plot/agent",
	sessionDir: "/repo/.plot/sessions",
	skillsDir: "/repo/.plot/skills",
	extensionsDir: "/repo/.plot/extensions",
	promptsDir: "/repo/.plot/prompts",
};

describe("extension source adapter", () => {
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

	test("adapts discovery and lifecycle hooks into WorkSource semantics", async () => {
		const lifecycle: string[] = [];
		let done = false;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: {
				id: "github-pr-reviewer",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				discover: () =>
					done
						? []
						: [
								{
									id: "github:acme/web:pr:42",
									version: "sha-1",
									context: { repo: "acme/web", prNumber: 42 },
								},
							],
				started: ({ work, runId }) => {
					lifecycle.push(`started:${work.id}:${runId}`);
				},
				completed: ({ work, output }) => {
					done = true;
					lifecycle.push(`completed:${work.id}:${String(output)}`);
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

		expect(first.started).toHaveLength(1);
		expect(second.completions).toHaveLength(1);
		expect(third.started).toHaveLength(0);
		expect(lifecycle).toEqual([
			"started:github:acme/web:pr:42:run-0",
			"completed:github:acme/web:pr:42:ok",
		]);
	});

	test("rejects invalid discovered work at the source boundary", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "bad", create: () => ({ discover: () => [] }) },
			runtime: { discover: () => [{ version: "v1" }] as never },
		});
		const agent = makePlotAgentLayer({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const result = await agent.tickOnce();

		expect(result.diagnostics[0]?.message).toContain("expected string");
	});

	test("superseded versions drain; blocked work holds claim without redispatch", async () => {
		let version = "sha-1";
		let blocked = false;
		const firstStarted = deferred<void>();
		const secondStarted = deferred<void>();
		const releaseFirst = deferred<string>();
		const releaseSecond = deferred<string>();
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
						...(blocked
							? {
									status: "blocked" as const,
									blockedReason: "waiting",
								}
							: {}),
					},
				],
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async ({ work }) => {
				if (String(work.workKey).endsWith(":sha-1")) {
					firstStarted.resolve();
					return { output: await releaseFirst.promise };
				}
				secondStarted.resolve();
				return { output: await releaseSecond.promise };
			},
		});
		const agent = makePlotAgentLayer({ sources: [bundle.source], runner });

		const first = await agent.tickOnce();
		await firstStarted.promise;
		version = "sha-2";
		const second = await agent.tickOnce();
		releaseFirst.resolve("phase complete");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const third = await agent.tickOnce();
		await secondStarted.promise;
		blocked = true;
		releaseSecond.resolve("done");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await agent.tickOnce();
		const fourth = await agent.tickOnce();
		const snapshot = await agent.snapshot();

		expect(first.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-1",
				),
			}),
		]);
		expect(second.started).toHaveLength(0);
		expect(third.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"extension:github-pr-reviewer:github:acme/web:pr:42:sha-2",
				),
			}),
		]);
		expect(fourth.started).toHaveLength(0);
		expect(
			snapshot.work.get(
				workKey("extension:github-pr-reviewer:github:acme/web:pr:42:sha-2"),
			),
		).toMatchObject({ status: "blocked", blockedReason: "waiting" });
	});

	test("binds registered tools to the current work", async () => {
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
					execute: async (params) => ({
						content: [
							{
								type: "text",
								text: `commented on ${work.id}: ${String((params as { body: string }).body)}`,
							},
						],
						details: { workId: work.id, runId },
					}),
				}),
			],
		});
		const runner: WorkRunner = {
			run: async (context) => {
				const create = await bundle.createOptions(context);
				const tool = create.customTools[0];
				expect(tool?.description).toBe(
					"Comment on github:acme/web:pr:42 during run-0 with test-token.",
				);
				const params = tool?.prepareArguments?.({
					body: "looks good",
					dynamic: true,
				});
				expect(params).toEqual({ body: "looks good" });
				const result = await tool?.execute(
					"tool-1",
					params as never,
					undefined,
					undefined,
					undefined as never,
				);
				expect(result?.content).toEqual([
					{
						type: "text",
						text: "commented on github:acme/web:pr:42: looks good",
					},
				]);
				return { output: "ok" };
			},
		};

		const agent = makePlotAgentLayer({
			sources: [bundle.source],
			runner,
		});

		expect((await agent.tickOnce()).started).toHaveLength(1);
	});

	test("loads local extensions through the public SDK virtual module", async () => {
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
});
