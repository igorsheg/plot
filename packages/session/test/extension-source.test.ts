import { describe, expect, test } from "bun:test";
import type {
	Completion,
	OperatorObservation,
	WorkItem,
	WorkRun,
} from "@plot/agent/model";
import type { SourceActiveRun } from "@plot/agent/work-source";
import {
	DiscoveryUnavailableError,
	defineTool,
	type ExtensionRequirementState,
	type PlotExtension,
	type PlotExtensionRuntime,
	type PlotExtensionWork,
} from "@plot/sdk";
import {
	makePlotExtensionSourceBundle,
	templateContextForWork,
	workKeyForExtensionWork,
	type SourceActionEvents,
} from "../src/extension-source.js";
import type { SessionPaths } from "../src/paths.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const paths: SessionPaths = {
	cwd: "/tmp/project",
	plotDir: "/tmp/project/.plot",
	agentDir: "/tmp/agent",
	sessionDir: "/tmp/project/.plot/sessions",
	skillsDir: "/tmp/agent/skills",
	extensionsDir: "/tmp/agent/extensions",
	promptsDir: "/tmp/agent/prompts",
};

const workflow: WorkflowDefinition = {
	config: {},
	runtime: {
		agent: { provider: "test", model: "test" },
		extension: { source: "test.ts" },
	},
	prompt: "{{ work.id }}",
};

const extension: PlotExtension = {
	id: "test",
	create: () => ({ discover: () => [] }),
};

const bundleFor = (runtime: PlotExtensionRuntime) =>
	makePlotExtensionSourceBundle({
		extension,
		runtime,
		workflow,
		paths,
		credentials: {
			get: async () => undefined,
			set: async () => {},
			delete: async () => {},
		},
		config: undefined,
		maxConcurrentRuns: 2,
	});

const tick = async (
	bundle: ReturnType<typeof bundleFor>,
	input: {
		activeRuns?: readonly SourceActiveRun[];
		operatorObservations?: readonly OperatorObservation[];
	} = {},
) => {
	const controller = new AbortController();
	return bundle.source.reconcile({
		tickId: 1,
		signal: controller.signal,
		operatorObservations: input.operatorObservations ?? [],
		activeRuns: input.activeRuns ?? [],
	});
};

const selected = (
	work: PlotExtensionWork,
	runId = "run-1",
): SourceActiveRun => {
	const item: WorkItem = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceData: work,
	};
	const run: WorkRun = {
		runId,
		sourceId: "extension:test",
		workKey: item.workKey,
	};
	return { run, work: item };
};

const events = () => {
	const values: string[] = [];
	const callbacks: SourceActionEvents = {
		started: async (id) => {
			values.push(`started:${id}`);
		},
		progress: async (_id, message) => {
			values.push(`progress:${message}`);
		},
		openUrl: async (_id, url, fallbackText) => {
			values.push(`url:${url}:${fallbackText ?? ""}`);
		},
		completed: async () => {
			values.push("completed");
		},
		failed: async (_id, message) => {
			values.push(`failed:${message}`);
		},
		cancelled: async () => {
			values.push("cancelled");
		},
	};
	return { values, callbacks };
};

const waitFor = async (condition: () => boolean) => {
	const deadline = Date.now() + 500;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition timed out");
		await Bun.sleep(2);
	}
};

describe("Extension Source", () => {
	test("validates discovery and returns exact Source work and dispatch", async () => {
		const work: PlotExtensionWork = {
			id: "issue:1",
			version: "v2",
			title: "Issue",
			context: { priority: "high" },
		};
		const bundle = bundleFor({ discover: () => [work] });
		const result = await tick(bundle);
		expect(result.source.readiness).toBe("ready");
		expect(result.work).toEqual([
			expect.objectContaining({ status: "pending", subject: "issue:1" }),
		]);
		expect(result.dispatch[0]).toMatchObject({
			workKey: workKeyForExtensionWork(extension, work),
			sourceData: work,
		});
		expect(result.dispatch[0]?.templateContext).toEqual({
			workflow: {},
			work: { id: "issue:1", version: "v2", title: "Issue" },
			priority: "high",
		});
		await bundle.shutdown();
	});

	test("preserves last-known work when discovery is unavailable", async () => {
		let unavailable = false;
		const work = { id: "issue:1" };
		const bundle = bundleFor({
			discover: () => {
				if (unavailable)
					throw new DiscoveryUnavailableError("network unavailable");
				return [work];
			},
		});
		expect((await tick(bundle)).work).toHaveLength(1);
		unavailable = true;
		const result = await tick(bundle);
		expect(result.source.readiness).toBe("unavailable");
		expect(result.work).toHaveLength(1);
		await bundle.shutdown();
	});

	test("reports cancellation for every active version of an id", async () => {
		const old = { id: "issue:1", version: "old" };
		const bundle = bundleFor({
			discover: () => [{ id: "issue:1", status: "cancelled" }],
		});
		const result = await tick(bundle, { activeRuns: [selected(old)] });
		expect(result.cancel).toEqual([
			{
				workKey: workKeyForExtensionWork(extension, old),
				reason: "work was cancelled by source extension:test",
			},
		]);
		await bundle.shutdown();
	});

	test("uses one exhaustive finished hook and schedules failed retry", async () => {
		const work = { id: "issue:1" };
		const finished: string[] = [];
		const bundle = bundleFor({
			discover: () => [work],
			finished: ({ work: completedWork, runId, completion }) => {
				finished.push(`${completedWork.id}:${runId}:${completion.status}`);
			},
		});
		const active = selected(work);
		const completion: Completion = {
			runId: active.run.runId,
			sourceId: active.run.sourceId,
			workKey: active.run.workKey,
			status: "failed",
			error: "boom",
		};
		await bundle.source.finished({
			run: active.run,
			work: active.work,
			completion,
		});
		const result = await tick(bundle);
		expect(finished).toEqual(["issue:1:run-1:failed"]);
		expect(result.dispatch).toEqual([]);
		expect(result.wakes?.[0]).toMatchObject({
			workKey: active.run.workKey,
			attempt: 1,
			delayMs: 10_000,
		});
		await bundle.shutdown();
	});

	test("passes the exact selected work to started and finished", async () => {
		const work = { id: "issue:1", context: { marker: true } };
		const lifecycle: unknown[] = [];
		const bundle = bundleFor({
			discover: () => [work],
			started: (event) => {
				lifecycle.push(event.work);
			},
			finished: (event) => {
				lifecycle.push(event.work);
			},
		});
		const active = selected(work);
		await bundle.source.started({ run: active.run, work: active.work });
		await bundle.source.finished({
			run: active.run,
			work: active.work,
			completion: {
				runId: active.run.runId,
				sourceId: active.run.sourceId,
				workKey: active.run.workKey,
				status: "succeeded",
			},
		});
		expect(lifecycle).toEqual([work, work]);
		await bundle.shutdown();
	});

	test("owns requirement action admission and completion", async () => {
		let state: ExtensionRequirementState = {
			status: "action-required",
			message: "Connect",
			actions: [{ id: "connect", label: "Connect" }],
		};
		const bundle = bundleFor({
			requirements: [
				{
					id: "auth",
					label: "Auth",
					check: () => state,
					action: async ({ interaction, signal }) => {
						await interaction.reportProgress("connecting");
						await interaction.openUrl("https://example.com/connect", {
							fallbackText: "Open manually",
						});
						const callback = await interaction.createOAuthCallback({
							timeoutMs: 1_000,
						});
						const code = callback.wait({ signal });
						await fetch(`${callback.redirectUri}?code=authorized`);
						expect(await code).toBe("authorized");
						state = { status: "ready" };
					},
				},
			],
			discover: () => [],
		});
		await tick(bundle);
		const observed = events();
		const accepted = await bundle.startAction({
			requirementId: "auth",
			actionId: "connect",
			events: observed.callbacks,
		});
		expect(accepted.accepted).toBe(true);
		await waitFor(() => observed.values.includes("completed"));
		expect(observed.values).toContain("progress:connecting");
		expect(observed.values).toContain(
			"url:https://example.com/connect:Open manually",
		);
		expect((await tick(bundle)).source.readiness).toBe("ready");
		await bundle.shutdown();
	});

	test("cancels and joins an active requirement action during shutdown", async () => {
		const bundle = bundleFor({
			requirements: [
				{
					id: "auth",
					label: "Auth",
					check: () => ({
						status: "action-required",
						message: "Connect",
						actions: [{ id: "connect", label: "Connect" }],
					}),
					action: ({ signal }) =>
						new Promise<void>((_resolve, reject) =>
							signal.addEventListener("abort", () =>
								reject(new Error("abort")),
							),
						),
				},
			],
			discover: () => [],
		});
		await tick(bundle);
		const observed = events();
		const accepted = await bundle.startAction({
			requirementId: "auth",
			actionId: "connect",
			events: observed.callbacks,
		});
		expect(accepted.accepted).toBe(true);
		await bundle.shutdown();
		expect(observed.values).toContain("cancelled");
	});

	test("ignores a stale action success after cancellation", async () => {
		let release!: () => void;
		const action = new Promise<void>((resolve) => (release = resolve));
		const bundle = bundleFor({
			requirements: [
				{
					id: "auth",
					label: "Auth",
					check: () => ({
						status: "action-required",
						message: "Connect",
						actions: [{ id: "connect", label: "Connect" }],
					}),
					action: () => action,
				},
			],
			discover: () => [],
		});
		await tick(bundle);
		const observed = events();
		const started = await bundle.startAction({
			requirementId: "auth",
			actionId: "connect",
			events: observed.callbacks,
		});
		if (!started.accepted) throw new Error("action was not accepted");
		expect(bundle.cancelAction(started.actionRunId)).toBe(true);
		release();
		await waitFor(() => observed.values.includes("cancelled"));
		expect(observed.values).not.toContain("completed");
		await bundle.shutdown();
	});

	test("returns runtime tools bound to required run identity", async () => {
		const bundle = bundleFor({
			discover: () => [],
			tools: [
				({ work, runId }) =>
					defineTool({
						name: "bound",
						label: "Bound",
						description: "Bound tool",
						parameters: { type: "object" },
						execute: () => ({
							content: [{ type: "text", text: `${work.id}:${runId}` }],
						}),
					}),
			],
		});
		const active = selected({ id: "issue:1" });
		const options = await bundle.createOptions({
			sourceId: active.run.sourceId,
			tickId: 1,
			run: active.run,
			work: active.work,
			signal: new AbortController().signal,
			reportActivity: () => {},
			shouldContinue: async () => true,
		});
		expect(options.customTools?.map((tool) => tool.name)).toEqual(["bound"]);
		await bundle.shutdown();
	});

	test("merges object context without hiding workflow and work metadata", () => {
		expect(
			templateContextForWork(workflow, {
				id: "one",
				context: { priority: 2 },
			}) as Record<string, unknown>,
		).toEqual({ workflow: {}, work: { id: "one" }, priority: 2 });
	});
});
