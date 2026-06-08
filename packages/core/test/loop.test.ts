import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeOrchestratorLayer, Orchestrator } from "../src/loop.js";
import type { CapabilityDefinition, PlotPlugin } from "../src/plugin.js";

const runWith = <A>(
	plugins: readonly PlotPlugin[],
	effect: Effect.Effect<A, never, Orchestrator>,
	capabilities: readonly CapabilityDefinition[] = [],
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(
				makeOrchestratorLayer({
					plugins,
					capabilities,
					policy: {
						grants: Object.fromEntries(
							plugins.map((plugin) => [plugin.id, plugin.manifest?.uses ?? []]),
						),
					},
				}),
			),
		),
	);

describe("task-agnostic Plot loop", () => {
	test("reconciles observations before planning, and action completions wait for the next reconciliation", async () => {
		const plugin: PlotPlugin = {
			id: "demo",
			manifest: { uses: ["mark-reviewed"] },
			observeTick: () => Effect.succeed([{ type: "seen", subject: "work-1" }]),
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
			plan: ({ snapshot }) =>
				snapshot.facts.get("seen:work-1") === true &&
				!snapshot.facts.has("completed:work-1")
					? Effect.succeed([
							{
								capability: "mark-reviewed",
								input: { ok: true },
								subject: "work-1",
								idempotencyKey: "review:work-1",
							},
						])
					: Effect.succeed([]),
		};
		const capability: CapabilityDefinition = {
			id: "mark-reviewed",
			execute: () => Effect.succeed({ wrote: true }),
		};

		const result = await runWith(
			[plugin],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				const afterFirst = yield* orchestrator.snapshot();
				const second = yield* orchestrator.tickOnce();
				return { first, afterFirst, second };
			}),
			[capability],
		);

		expect(result.first.admitted).toHaveLength(1);
		expect(result.afterFirst.facts.get("seen:work-1")).toBe(true);
		expect(result.afterFirst.facts.has("completed:work-1")).toBe(false);
		expect(result.second.snapshot.facts.get("completed:work-1")).toBe(
			"succeeded",
		);
	});

	test("built-in and user capabilities use the same declaration and grant admission path", async () => {
		const calls: string[] = [];
		const plugins: PlotPlugin[] = [
			{
				id: "builtin-style-plugin",
				manifest: { uses: ["builtin-capability"] },
				plan: () =>
					Effect.succeed([
						{
							capability: "builtin-capability",
							input: "ok",
							subject: "a",
						},
					]),
			},
			{
				id: "user-style-plugin",
				manifest: { uses: ["user-capability"] },
				plan: () =>
					Effect.succeed([
						{
							capability: "user-capability",
							input: "ok",
							subject: "b",
						},
					]),
			},
			{
				id: "ungranted-plugin",
				manifest: { uses: ["user-capability"] },
				plan: () =>
					Effect.succeed([
						{
							capability: "user-capability",
							input: "blocked",
							subject: "c",
						},
					]),
			},
			{
				id: "undeclared-plugin",
				plan: () =>
					Effect.succeed([
						{
							capability: "user-capability",
							input: "blocked",
							subject: "d",
						},
					]),
			},
		];
		const capabilities: CapabilityDefinition[] = [
			{
				id: "builtin-capability",
				execute: ({ subject }) =>
					Effect.sync(() => {
						calls.push(`builtin:${subject}`);
						return subject;
					}),
			},
			{
				id: "user-capability",
				execute: ({ subject }) =>
					Effect.sync(() => {
						calls.push(`user:${subject}`);
						return subject;
					}),
			},
		];

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				return yield* orchestrator.tickOnce();
			}).pipe(
				Effect.provide(
					makeOrchestratorLayer({
						plugins,
						capabilities,
						policy: {
							grants: {
								"builtin-style-plugin": ["builtin-capability"],
								"user-style-plugin": ["user-capability"],
							},
						},
					}),
				),
			),
		);

		expect(calls).toEqual(["builtin:a", "user:b"]);
		expect(
			result.completions.filter(
				(completion) => completion.status === "succeeded",
			),
		).toHaveLength(2);
		expect(
			result.completions.filter(
				(completion) => completion.status === "rejected",
			),
		).toHaveLength(2);
		expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
			"plugin is not granted capability use",
			"plugin did not declare capability use",
		]);
	});
});
