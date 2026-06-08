import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Schema } from "effect";
import {
	capabilityId,
	idempotencyKey,
	pluginId,
	subjectKey,
} from "../src/domain.js";
import { makeOrchestratorLayer, Orchestrator } from "../src/loop.js";
import type { CapabilityDefinition, PlotPlugin } from "../src/plugin.js";

const markReviewed = capabilityId("mark-reviewed");
const builtinCapability = capabilityId("builtin-capability");
const userCapability = capabilityId("user-capability");
const schemaCapability = capabilityId("schema-capability");

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
		const work = subjectKey("work-1");
		const plugin: PlotPlugin = {
			id: pluginId("demo"),
			manifest: { uses: [markReviewed] },
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
			plan: ({ snapshot }) =>
				snapshot.facts.get("seen:work-1") === true &&
				!snapshot.facts.has("completed:work-1")
					? Effect.succeed([
							{
								capability: markReviewed,
								input: { ok: true },
								subject: work,
								idempotencyKey: idempotencyKey("review:work-1"),
							},
						])
					: Effect.succeed([]),
		};
		const capability: CapabilityDefinition = {
			id: markReviewed,
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
				const fiber = yield* orchestrator.run().pipe(Effect.forkChild);
				yield* orchestrator.offer({ type: "tick" });
				yield* orchestrator.offer({ type: "shutdown" });
				yield* Fiber.join(fiber);
				return yield* orchestrator.snapshot();
			}),
		);

		expect(result.facts.get("actor:actor-work")).toBe(true);
	});

	test("built-in and user capabilities use the same declaration and grant admission path", async () => {
		const calls: string[] = [];
		const builtinPlugin = pluginId("builtin-style-plugin");
		const userPlugin = pluginId("user-style-plugin");
		const ungrantedPlugin = pluginId("ungranted-plugin");
		const undeclaredPlugin = pluginId("undeclared-plugin");
		const schemaPlugin = pluginId("schema-plugin");

		const plugins: PlotPlugin[] = [
			{
				id: builtinPlugin,
				manifest: { uses: [builtinCapability] },
				plan: () =>
					Effect.succeed([
						{
							capability: builtinCapability,
							input: "ok",
							subject: subjectKey("a"),
						},
					]),
			},
			{
				id: userPlugin,
				manifest: { uses: [userCapability] },
				plan: () =>
					Effect.succeed([
						{
							capability: userCapability,
							input: "ok",
							subject: subjectKey("b"),
						},
					]),
			},
			{
				id: ungrantedPlugin,
				manifest: { uses: [userCapability] },
				plan: () =>
					Effect.succeed([
						{
							capability: userCapability,
							input: "blocked",
							subject: subjectKey("c"),
						},
					]),
			},
			{
				id: undeclaredPlugin,
				plan: () =>
					Effect.succeed([
						{
							capability: userCapability,
							input: "blocked",
							subject: subjectKey("d"),
						},
					]),
			},
			{
				id: schemaPlugin,
				manifest: { uses: [schemaCapability] },
				plan: () =>
					Effect.succeed([
						{
							capability: schemaCapability,
							input: "not-the-schema",
							subject: subjectKey("e"),
						},
					]),
			},
		];
		const capabilities: CapabilityDefinition[] = [
			{
				id: builtinCapability,
				execute: ({ subject }) =>
					Effect.sync(() => {
						calls.push(`builtin:${subject}`);
						return subject;
					}),
			},
			{
				id: userCapability,
				execute: ({ subject }) =>
					Effect.sync(() => {
						calls.push(`user:${subject}`);
						return subject;
					}),
			},
			{
				id: schemaCapability,
				input: Schema.Struct({ ok: Schema.Boolean }),
				execute: ({ subject }) =>
					Effect.sync(() => {
						calls.push(`schema:${subject}`);
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
								[builtinPlugin]: [builtinCapability],
								[userPlugin]: [userCapability],
								[schemaPlugin]: [schemaCapability],
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
		expect(
			result.completions.filter((completion) => completion.status === "failed"),
		).toHaveLength(1);
		const diagnosticMessages = result.diagnostics.map(
			(diagnostic) => diagnostic.message,
		);
		expect(diagnosticMessages.slice(0, 2)).toEqual([
			"plugin is not granted capability use",
			"plugin did not declare capability use",
		]);
		expect(diagnosticMessages[2]?.startsWith("SchemaError")).toBe(true);
	});
});
