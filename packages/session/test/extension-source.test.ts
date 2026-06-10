import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import type { WorkRunner } from "@plot/agent/work-runner";
import { PlotAgent, makePlotAgentLayer } from "@plot/agent/agent";
import { workKey } from "@plot/agent/model";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	makePlotExtensionSourceBundle,
} from "../src/extension-source.js";
import type { PlotPaths } from "../src/plot-paths.js";
import type { WorkflowDefinition } from "../src/workflow.js";

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
			run: ({ work }) =>
				Effect.sync(() => {
					expect(work.templateContext).toEqual(
						expect.objectContaining({
							workflow: { name: "extension-test" },
							repo: "acme/web",
							prNumber: 42,
						}),
					);
					return { output: "ok" };
				}),
		});

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* PlotAgent;
					const first = yield* agent.tickOnce();
					yield* Effect.yieldNow;
					const second = yield* agent.tickOnce();
					const third = yield* agent.tickOnce();
					yield* bundle.shutdown();
					return { first, second, third };
				}),
			).pipe(
				Effect.provide(
					makePlotAgentLayer({ sources: [bundle.source], runner }),
				),
			),
		);

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
		const firstStarted = Deferred.makeUnsafe<void>();
		const secondStarted = Deferred.makeUnsafe<void>();
		const firstInterrupted = Deferred.makeUnsafe<void>();
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
			run: ({ work }) =>
				Effect.gen(function* () {
					if (String(work.workKey).endsWith(":sha-1")) {
						yield* Deferred.succeed(firstStarted, undefined);
						return yield* Effect.never.pipe(
							Effect.ensuring(Deferred.succeed(firstInterrupted, undefined)),
						);
					}
					yield* Deferred.succeed(secondStarted, undefined);
					return yield* Effect.never;
				}),
		});

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const agent = yield* PlotAgent;
					const first = yield* agent.tickOnce();
					yield* Deferred.await(firstStarted);
					version = "sha-2";
					const second = yield* agent.tickOnce();
					yield* Deferred.await(firstInterrupted);
					yield* Deferred.await(secondStarted);
					const third = yield* agent.tickOnce();
					const snapshot = yield* agent.snapshot();
					return { first, second, third, snapshot };
				}),
			).pipe(
				Effect.provide(
					makePlotAgentLayer({ sources: [bundle.source], runner }),
				),
			),
		);

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

	test("loads a local extension module from WORKFLOW.md config", async () => {
		const dir = await makeTempDir();
		const extensionPath = join(dir, "extension.ts");
		await writeFile(
			extensionPath,
			`export default {\n  id: "local-test",\n  parseConfig: (input) => input,\n  create: ({ config, work }) => ({\n    discover: () => [work({ id: config.id, version: "v1", context: { value: 1 } })]\n  })\n};\n`,
		);
		const loaded = await Effect.runPromise(
			loadPlotExtensionRuntimeFromWorkflow({
				paths: { ...paths, cwd: dir },
				workflow: {
					...workflow,
					path: join(dir, "WORKFLOW.md"),
					runtime: {
						extension: { source: "./extension.ts", config: { id: "work:1" } },
					},
				},
			}),
		);

		expect(loaded.extension.id).toBe("local-test");
		expect(await loaded.runtime.discover()).toEqual([
			{ id: "work:1", version: "v1", context: { value: 1 } },
		]);
	});
});
