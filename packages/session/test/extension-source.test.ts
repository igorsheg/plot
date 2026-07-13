import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { makePlotAgent } from "@plot/agent/agent";
import {
	DiscoveryUnavailableError,
	ExtensionActionRequiredError,
} from "@plot/sdk";
import type { WorkRunner } from "@plot/agent/work-runner";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	resolveToolDefinitions,
} from "../src/extension-loader.js";
import { makePlotExtensionSourceBundle } from "../src/extension-source.js";
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
	runtime: {
		agent: { provider: "test", model: "fake" },
		extension: { source: "./extension.ts" },
	},
	prompt: "Review {{ repo }} #{{ prNumber }} with {{ workflow.name }}.",
};

const workKey = (
	extensionId: string,
	workId: string,
	version?: string,
): string =>
	`extension:${JSON.stringify([extensionId, workId, version ?? null])}`;

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

		const agent = makePlotAgent({ sources: [bundle.source], runner });
		const first = await agent.tickOnce();
		await Promise.resolve();
		const second = await agent.tickOnce();
		const third = await agent.tickOnce();

		expect(first.started).toHaveLength(1);
		expect(second.completions).toHaveLength(1);
		expect(third.started).toHaveLength(0);
		expect(lifecycle[0]).toMatch(
			/^started:github:acme\/web:pr:42:run-[0-9a-f-]+-0$/,
		);
		expect(lifecycle[1]).toBe("completed:github:acme/web:pr:42:ok");
	});

	test("rejects invalid discovered work at the source boundary", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "bad", create: () => ({ discover: () => [] }) },
			runtime: { discover: () => [{ version: "v1" }] as never },
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const result = await agent.tickOnce();

		expect(result.diagnostics[0]?.message).toContain("id");
	});

	test("work identity encodes id and version without delimiter collisions", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "identity", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [
					{ id: "a:b", version: "c" },
					{ id: "a", version: "b:c" },
					{ id: "without-version" },
					{ id: "without-version", version: "unversioned" },
				],
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const result = await agent.tickOnce();

		expect(new Set(result.started.map((run) => run.workKey)).size).toBe(4);
		await agent.shutdown();
	});

	test("rejects duplicate discovered work identities", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "duplicates", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [
					{ id: "same", version: "v1" },
					{ id: "same", version: "v1" },
				],
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const result = await agent.tickOnce();

		expect(result.started).toHaveLength(0);
		expect(result.diagnostics[0]?.message).toContain(
			"duplicate discovered work",
		);
		await agent.shutdown();
	});

	test("gates discovery until every extension requirement is ready", async () => {
		let ready = false;
		let discoveries = 0;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: {
				id: "jira",
				label: "Wix Jira",
				create: () => ({ discover: () => [] }),
			},
			runtime: {
				requirements: [
					{
						id: "wix-mcp",
						label: "Wix MCP",
						check: () =>
							ready
								? { status: "ready" as const }
								: {
										status: "action-required" as const,
										message: "Connect Wix MCP to discover Jira issues",
										actions: [{ id: "connect", label: "Connect Wix MCP" }],
									},
					},
				],
				discover: () => {
					discoveries++;
					return [{ id: "jira:1", version: "v1" }];
				},
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const blocked = await agent.tickOnce();
		const blockedSource = blocked.snapshot.sources.get("extension:jira");
		ready = true;
		const resumed = await agent.tickOnce();

		expect(discoveries).toBe(1);
		expect(blocked.started).toHaveLength(0);
		expect(blockedSource).toEqual({
			sourceId: "extension:jira",
			label: "Wix Jira",
			readiness: "action-required",
			message: "Connect Wix MCP to discover Jira issues",
			requirements: [
				{
					id: "wix-mcp",
					label: "Wix MCP",
					status: "action-required",
					message: "Connect Wix MCP to discover Jira issues",
					actions: [{ id: "connect", label: "Connect Wix MCP" }],
				},
			],
		});
		expect(resumed.started).toHaveLength(1);
		expect(resumed.snapshot.sources.get("extension:jira")?.readiness).toBe(
			"ready",
		);
		await agent.shutdown();
	});

	test("a Source setup action rechecks readiness and enables discovery", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "setup", create: () => ({ discover: () => [] }) },
			runtime: {
				requirements: [
					{
						id: "config",
						label: "Configuration",
						check: async ({ credentials }) =>
							(await credentials.get("ready")) === true
								? { status: "ready" as const }
								: {
										status: "action-required" as const,
										message: "Configure the Source",
										actions: [{ id: "configure", label: "Configure" }],
									},
						action: async ({ credentials }) => {
							await credentials.set("ready", true);
						},
					},
				],
				discover: () => [{ id: "work:1", version: "v1" }],
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});
		await agent.tickOnce();

		const source = await bundle.runAction({
			requirementId: "config",
			actionId: "configure",
			interaction: {
				openUrl: () => {},
				createOAuthCallback: async () => ({
					redirectUri: "http://127.0.0.1/callback",
					wait: async () => "code",
				}),
				reportProgress: () => {},
			},
			signal: new AbortController().signal,
		});
		const resumed = await agent.tickOnce();

		expect(source.readiness).toBe("ready");
		expect(resumed.started).toHaveLength(1);
		await agent.shutdown();
	});

	test("preserves last-known work when a requirement loses readiness", async () => {
		let ready = true;
		let discoveries = 0;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "preserve", create: () => ({ discover: () => [] }) },
			runtime: {
				requirements: [
					{
						id: "config",
						label: "Configuration",
						check: () =>
							ready
								? { status: "ready" as const }
								: {
										status: "action-required" as const,
										message: "Set JIRA_URL",
										actions: [],
									},
					},
				],
				discover: () => {
					discoveries++;
					return [{ id: "jira:1", version: "v1", status: "waiting" as const }];
				},
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		await agent.tickOnce();
		ready = false;
		const blocked = await agent.tickOnce();

		expect(discoveries).toBe(1);
		expect(blocked.snapshot.work.has(workKey("preserve", "jira:1", "v1"))).toBe(
			true,
		);
		expect(blocked.started).toHaveLength(0);
		await agent.shutdown();
	});

	test("typed discovery outages mark the Source unavailable and preserve work", async () => {
		let unavailable = false;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "outage", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => {
					if (unavailable)
						throw new DiscoveryUnavailableError("Jira is offline");
					return [{ id: "work:1", version: "v1", status: "waiting" as const }];
				},
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});
		await agent.tickOnce();
		unavailable = true;
		const result = await agent.tickOnce();

		expect(result.snapshot.sources.get("extension:outage")).toMatchObject({
			readiness: "unavailable",
			message: "Jira is offline",
		});
		expect(result.snapshot.work.has(workKey("outage", "work:1", "v1"))).toBe(
			true,
		);
		await agent.shutdown();
	});

	test("runtime credential expiry moves the Source to action-required without draining work", async () => {
		let expired = false;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "expiry", create: () => ({ discover: () => [] }) },
			runtime: {
				requirements: [
					{
						id: "auth",
						label: "Authentication",
						check: () => ({ status: "ready" }),
					},
				],
				discover: () => {
					if (expired)
						throw new ExtensionActionRequiredError({
							requirementId: "auth",
							message: "Authorization expired",
						});
					return [{ id: "work:1", version: "v1", status: "waiting" as const }];
				},
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});
		await agent.tickOnce();
		expired = true;
		const result = await agent.tickOnce();

		expect(result.snapshot.sources.get("extension:expiry")).toMatchObject({
			readiness: "action-required",
			requirements: [
				{
					id: "auth",
					status: "action-required",
					message: "Authorization expired",
				},
			],
		});
		expect(result.snapshot.work.has(workKey("expiry", "work:1", "v1"))).toBe(
			true,
		);
		await agent.shutdown();
	});

	test("waiting work stays visible without dispatch", async () => {
		let runs = 0;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "waiting", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [
					{
						id: "work:1",
						version: "v1",
						status: "waiting" as const,
						blockedReason: "reviewed at this head",
					},
				],
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: {
				run: () => {
					runs++;
					return {};
				},
			},
		});

		const first = await agent.tickOnce();
		const second = await agent.tickOnce();
		const snapshot = await agent.snapshot();

		expect(first.started).toHaveLength(0);
		expect(second.started).toHaveLength(0);
		expect(runs).toBe(0);
		expect(snapshot.work.get(workKey("waiting", "work:1", "v1"))).toMatchObject(
			{
				status: "waiting",
				blockedReason: "reviewed at this head",
			},
		);
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
				if (
					work.workKey ===
					workKey("github-pr-reviewer", "github:acme/web:pr:42", "sha-1")
				) {
					firstStarted.resolve();
					return { output: await releaseFirst.promise };
				}
				secondStarted.resolve();
				return { output: await releaseSecond.promise };
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });

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
					"github-pr-reviewer",
					"github:acme/web:pr:42",
					"sha-1",
				),
			}),
		]);
		expect(second.started).toHaveLength(0);
		expect(third.started).toEqual([
			expect.objectContaining({
				workKey: workKey(
					"github-pr-reviewer",
					"github:acme/web:pr:42",
					"sha-2",
				),
			}),
		]);
		expect(fourth.started).toHaveLength(0);
		expect(
			snapshot.work.get(
				workKey("github-pr-reviewer", "github:acme/web:pr:42", "sha-2"),
			),
		).toMatchObject({ status: "blocked", blockedReason: "waiting" });
	});

	test("work that disappears mid-run drains instead of interrupting", async () => {
		let discovered = true;
		const started = deferred<void>();
		const release = deferred<string>();
		const lifecycle: string[] = [];
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "drain", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => (discovered ? [{ id: "work:1", version: "v1" }] : []),
				completed: ({ work }) => {
					lifecycle.push(`completed:${work.id}`);
				},
				interrupted: ({ work }) => {
					lifecycle.push(`interrupted:${work.id}`);
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async () => {
				started.resolve();
				return { output: await release.promise };
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });
		const key = workKey("drain", "work:1", "v1");

		const first = await agent.tickOnce();
		await started.promise;
		discovered = false;
		const second = await agent.tickOnce();
		const drainingSnapshot = await agent.snapshot();
		release.resolve("review posted");
		await new Promise((resolve) => setTimeout(resolve, 0));
		const third = await agent.tickOnce();

		expect(first.started).toHaveLength(1);
		expect(second.completions).toHaveLength(0);
		expect(drainingSnapshot.work.get(key)).toMatchObject({
			status: "draining",
		});
		expect(third.completions).toEqual([
			expect.objectContaining({ status: "succeeded" }),
		]);
		expect((await agent.snapshot()).work.has(key)).toBe(false);
		expect(lifecycle).toEqual(["completed:work:1"]);
	});

	test("cancelled work interrupts the active run and releases the claim", async () => {
		let cancelled = false;
		const started = deferred<void>();
		const never = deferred<string>();
		const lifecycle: string[] = [];
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "cancel", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [
					{
						id: "work:1",
						version: "v1",
						...(cancelled ? { status: "cancelled" as const } : {}),
					},
				],
				interrupted: ({ work }) => {
					lifecycle.push(`interrupted:${work.id}`);
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async () => {
				started.resolve();
				return { output: await never.promise };
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });
		const key = workKey("cancel", "work:1", "v1");

		const first = await agent.tickOnce();
		await started.promise;
		cancelled = true;
		const second = await agent.tickOnce();
		const third = await agent.tickOnce();

		expect(first.started).toHaveLength(1);
		expect(second.completions).toEqual([
			expect.objectContaining({ status: "interrupted" }),
		]);
		expect((await agent.snapshot()).work.has(key)).toBe(false);
		expect(third.started).toHaveLength(0);
		// Interruption is a deliberate act, not a failure: no retry backoff.
		expect(
			third.proposals.filter((p) => p.type === "schedule_wake"),
		).toHaveLength(0);
		expect(lifecycle).toEqual(["interrupted:work:1"]);
	});

	test("shutdown delivers interrupted hooks for active extension runs", async () => {
		const started = deferred<void>();
		const interrupted: string[] = [];
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "shutdown", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [{ id: "work:1", version: "v1" }],
				interrupted: ({ work, runId }) => {
					interrupted.push(`${work.id}:${runId}`);
				},
			},
		});
		const runner = bundle.wrapRunner({
			run: ({ signal }) =>
				new Promise((_, reject) => {
					started.resolve();
					signal.addEventListener("abort", () => reject(new Error("aborted")), {
						once: true,
					});
				}),
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });

		await agent.tickOnce();
		await started.promise;
		await agent.shutdown();
		await bundle.shutdown();

		expect(interrupted).toHaveLength(1);
		expect(interrupted[0]).toMatch(/^work:1:run-/);
	});

	test("failed runs hold redispatch behind exponential retry backoff", async () => {
		let runs = 0;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "retry", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [{ id: "work:1", version: "v1" }],
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: () => {
				runs++;
				throw new Error("boom");
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });
		const key = workKey("retry", "work:1", "v1");

		const first = await agent.tickOnce();
		await new Promise((resolve) => setTimeout(resolve, 0));
		const second = await agent.tickOnce();
		const third = await agent.tickOnce();
		const snapshot = await agent.snapshot();

		expect(first.started).toHaveLength(1);
		expect(second.completions).toEqual([
			expect.objectContaining({ status: "failed" }),
		]);
		expect(second.proposals).toContainEqual(
			expect.objectContaining({
				type: "schedule_wake",
				delayMs: 10_000,
				attempt: 1,
				workKey: key,
			}),
		);
		// Work is rediscovered but held while the retry wake is pending.
		expect(third.started).toHaveLength(0);
		expect(runs).toBe(1);
		expect(snapshot.facts.get("extension.retry:extension:retry")).toEqual({
			[String(key)]: 1,
		});
		expect(snapshot.scheduledWakes).toContainEqual(
			expect.objectContaining({ workKey: key, attempt: 1 }),
		);
	});

	test("workspace is created before the run and becomes the session cwd", async () => {
		const dir = await makeTempDir();
		const workspace = join(dir, "nested", "pr-1");
		const finished = deferred<void>();
		let cwd: string | undefined;
		let workspaceExisted = false;
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "ws", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [{ id: "work:1", version: "v1", workspace }],
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async (context) => {
				const { stat } = await import("node:fs/promises");
				workspaceExisted = (await stat(workspace)).isDirectory();
				cwd = (await bundle.createOptions(context)).cwd;
				finished.resolve();
				return {};
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });

		expect((await agent.tickOnce()).started).toHaveLength(1);
		await finished.promise;

		expect(workspaceExisted).toBe(true);
		expect(cwd).toBe(workspace);
	});

	test("rejects relative workspace paths at the source boundary", async () => {
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "ws-bad", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => [
					{ id: "work:1", version: "v1", workspace: "relative/path" },
				],
			},
		});
		const agent = makePlotAgent({
			sources: [bundle.source],
			runner: { run: () => ({}) },
		});

		const result = await agent.tickOnce();

		expect(result.diagnostics[0]?.message).toContain("absolute");
		expect(result.started).toHaveLength(0);
	});

	test("discovery is polled once per tick and continuation reads the fact", async () => {
		let discoverCalls = 0;
		const started = deferred<void>();
		const release = deferred<string>();
		const bundle = makePlotExtensionSourceBundle({
			workflow,
			paths,
			config: undefined,
			extension: { id: "poll", create: () => ({ discover: () => [] }) },
			runtime: {
				discover: () => {
					discoverCalls++;
					return [{ id: "work:1", version: "v1" }];
				},
			},
		});
		const runner: WorkRunner = bundle.wrapRunner({
			run: async () => {
				started.resolve();
				return { output: await release.promise };
			},
		});
		const agent = makePlotAgent({ sources: [bundle.source], runner });
		const key = workKey("poll", "work:1", "v1");

		await agent.tickOnce();
		await started.promise;
		const callsAfterFirstTick = discoverCalls;
		const snapshot = await agent.snapshot();
		const shouldContinue = await bundle.source.continueWork?.({
			sourceId: bundle.source.id,
			tickId: snapshot.tickId,
			snapshot,
			signal: new AbortController().signal,
			run: { runId: "run-0", sourceId: bundle.source.id, workKey: key },
			work: { workKey: key },
			turnNumber: 1,
		});
		release.resolve("done");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await agent.tickOnce();

		expect(callsAfterFirstTick).toBe(1);
		expect(shouldContinue).toBe(true);
		// One observe-driven poll per tick; completion processing does not re-poll.
		expect(discoverCalls).toBe(2);
	});

	test("rejects duplicate extension tool names", async () => {
		const tool = {
			name: "duplicate",
			label: "Duplicate",
			description: "Duplicate tool",
			parameters: { type: "object" as const },
			execute: () => ({ content: [{ type: "text" as const, text: "ok" }] }),
		};
		await expect(
			resolveToolDefinitions({
				tools: [tool, tool],
				workflow,
				paths,
				config: undefined,
				work: { id: "work:1" },
			}),
		).rejects.toThrow("duplicate extension tool name");
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
				const tool = create.customTools?.[0];
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

		const agent = makePlotAgent({
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
				runtime: {
					agent: { provider: "test", model: "fake" },
					extension: { source: "./extension.ts" },
				},
			},
		});

		expect(loaded.extension.id).toBe("public-sdk-test");
		expect(await loaded.runtime.discover()).toEqual([
			{ id: "work:from-sdk", version: "v1" },
		]);
	});
});
