import { describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { pluginId, PlotLoopError, subjectKey } from "../src/domain.js";
import { makeOrchestratorLayer, Orchestrator } from "../src/loop.js";
import type { PlotPlugin } from "../src/plugin.js";

const runWith = <A>(
	plugins: readonly PlotPlugin[],
	effect: Effect.Effect<A, never, Orchestrator>,
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(
				makeOrchestratorLayer({
					plugins,
				}),
			),
		),
	);

describe("task-agnostic Plot loop", () => {
	test("setup rejects invalid runtime config with typed loop errors", async () => {
		const error = await Effect.runPromise(
			Effect.service(Orchestrator).pipe(
				Effect.provide(
					makeOrchestratorLayer({
						plugins: [],
						queueCapacity: 0,
					}),
				),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PlotLoopError);
		expect(error.phase).toBe("setup");
		expect(error.message).toBe("queueCapacity must be a positive integer");
	});

	test("reconciles observations before acting, and completions apply on the next reconciliation", async () => {
		const work = subjectKey("work-1");
		const plugin: PlotPlugin = {
			id: pluginId("demo"),
			observeTick: () => Effect.succeed([{ type: "seen", subject: work }]),
			reconcile: ({ snapshot }) =>
				Effect.succeed([
					...snapshot.observations.map((observation) => ({
						type: "set_fact" as const,
						key: `seen:${observation.subject ?? "unknown"}`,
						value: true,
					})),
					...snapshot.completions.map((completion) => ({
						type: "set_fact" as const,
						key: `completed:${completion.subject ?? "unknown"}`,
						value: completion.status,
					})),
				]),
			act: ({ snapshot }) =>
				snapshot.facts.get("seen:work-1") === true &&
				!snapshot.facts.has("completed:work-1")
					? Effect.succeed({
							type: "completed" as const,
							subject: work,
							output: { reviewed: true },
						})
					: Effect.succeed({ type: "idle" as const }),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				const afterFirst = yield* orchestrator.snapshot();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, afterFirst, second };
			}),
		);

		expect(result.first.started).toHaveLength(1);
		expect(result.first.completions).toHaveLength(0);
		expect(result.afterFirst.facts.get("seen:work-1")).toBe(true);
		expect(result.afterFirst.facts.has("completed:work-1")).toBe(false);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", subject: work }),
		);
		expect(result.second.snapshot.facts.get("completed:work-1")).toBe(
			"succeeded",
		);
	});

	test("tickOnce starts long plugin work without waiting for completion", async () => {
		const release = Deferred.makeUnsafe<string>();
		const plugin: PlotPlugin = {
			id: pluginId("slow-plugin"),
			act: () =>
				Deferred.await(release).pipe(
					Effect.map((output) => ({ type: "completed" as const, output })),
				),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				yield* Deferred.succeed(release, "finished");
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
			}),
		);

		expect(result.first.started).toHaveLength(1);
		expect(result.first.completions).toHaveLength(0);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", output: "finished" }),
		);
	});

	test("actor run consumes queued wake sources and owns the loop", async () => {
		const work = subjectKey("actor-work");
		const plugin: PlotPlugin = {
			id: pluginId("actor-plugin"),
			observeTick: () =>
				Effect.succeed([{ type: "actor-seen", subject: work }]),
			reconcile: ({ snapshot }) =>
				Effect.succeed(
					snapshot.observations.map((observation) => ({
						type: "set_fact" as const,
						key: `actor:${observation.subject ?? "unknown"}`,
						value: true,
					})),
				),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.start();
				yield* orchestrator.offer({ type: "tick" });
				yield* orchestrator.shutdown();
				yield* Effect.yieldNow;
				return yield* orchestrator.snapshot();
			}),
		);

		expect(result.facts.get("actor:actor-work")).toBe(true);
	});

	test("plugins own their inner TypeScript instead of requesting fine-grained capabilities", async () => {
		const calls: string[] = [];
		const pr = subjectKey("github:pr:42");
		const plugin: PlotPlugin = {
			id: pluginId("pr-reviewer"),
			observeTick: () =>
				Effect.succeed([
					{
						type: "github.pr.ready",
						subject: pr,
						data: { repo: "plot", number: 42, headSha: "abc123" },
					},
				]),
			reconcile: ({ snapshot }) =>
				Effect.succeed([
					...snapshot.observations.map((observation) => ({
						type: "set_fact" as const,
						key: `ready:${observation.subject ?? "unknown"}`,
						value: observation.data,
					})),
					...snapshot.completions.map((completion) => ({
						type: "set_fact" as const,
						key: `reviewed:${completion.subject ?? "unknown"}`,
						value: true,
					})),
				]),
			act: ({ snapshot }) =>
				Effect.sync(() => {
					const ready = snapshot.facts.get("ready:github:pr:42");
					const reviewed = snapshot.facts.get("reviewed:github:pr:42");
					if (!ready || reviewed) return { type: "idle" as const };
					calls.push("gh pr diff 42");
					calls.push("agent reviews diff with normal shell/tools");
					calls.push("gh pr comment 42");
					return {
						type: "completed" as const,
						subject: pr,
						output: { comments: 1 },
					};
				}),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
			}),
		);

		expect(result.first.started).toHaveLength(1);
		expect(calls).toEqual([
			"gh pr diff 42",
			"agent reviews diff with normal shell/tools",
			"gh pr comment 42",
		]);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({ subject: pr, status: "succeeded" }),
		);
	});

	test("runtime policy gates dispatch lifecycle, not inner agent tools", async () => {
		const release = Deferred.makeUnsafe<void>();
		const makePlugin = (id: string): PlotPlugin => ({
			id: pluginId(id),
			act: () =>
				Deferred.await(release).pipe(
					Effect.map(() => ({ type: "completed" as const })),
				),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				const snapshot = yield* orchestrator.snapshot();
				yield* Deferred.succeed(release, undefined);
				return { first, snapshot };
			}).pipe(
				Effect.provide(
					makeOrchestratorLayer({
						plugins: [makePlugin("one"), makePlugin("two")],
						policy: { maxConcurrentRuns: 1 },
					}),
				),
			),
		);

		expect(result.first.started).toHaveLength(1);
		expect(result.snapshot.running.has(pluginId("one"))).toBe(true);
		expect(result.snapshot.running.has(pluginId("two"))).toBe(false);
	});

	test("failed plugin acts become completions and diagnostics", async () => {
		const plugin: PlotPlugin = {
			id: pluginId("broken-plugin"),
			act: () => Effect.fail("boom"),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				return yield* orchestrator.tickOnce();
			}),
		);

		expect(result.completions).toContainEqual(
			expect.objectContaining({ pluginId: plugin.id, status: "failed" }),
		);
		expect(result.diagnostics[0]).toEqual(
			expect.objectContaining({
				pluginId: plugin.id,
				phase: "act",
				level: "error",
			}),
		);
	});
});
