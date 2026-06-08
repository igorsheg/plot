import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Schema } from "effect";
import {
	capabilityId,
	idempotencyKey,
	pluginId,
	PlotLoopError,
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
				yield* Effect.yieldNow;
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

	test("tickOnce admits long actions without waiting for completion", async () => {
		const capability = capabilityId("slow-capability");
		const release = Deferred.makeUnsafe<string>();
		const plugin: PlotPlugin = {
			id: pluginId("slow-plugin"),
			manifest: { uses: [capability] },
			plan: () =>
				Effect.succeed([
					{
						capability,
						input: "ok",
						idempotencyKey: idempotencyKey("slow-once"),
					},
				]),
		};

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				yield* Deferred.succeed(release, "finished");
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
			}).pipe(
				Effect.provide(
					makeOrchestratorLayer({
						plugins: [plugin],
						policy: {
							grants: {
								[plugin.id]: [capability],
							},
						},
						capabilities: [
							{
								id: capability,
								input: Schema.String,
								output: Schema.String,
								execute: () => Deferred.await(release),
							},
						],
					}),
				),
			),
		);

		expect(result.first.admitted).toHaveLength(1);
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
							idempotencyKey: idempotencyKey("builtin:a"),
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
							idempotencyKey: idempotencyKey("user:b"),
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
							idempotencyKey: idempotencyKey("schema:e"),
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
				const first = yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
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
			result.second.completions.filter(
				(completion) => completion.status === "succeeded",
			),
		).toHaveLength(2);
		expect(
			result.first.completions.filter(
				(completion) => completion.status === "rejected",
			),
		).toHaveLength(2);
		expect(
			result.second.completions.filter(
				(completion) => completion.status === "failed",
			),
		).toHaveLength(1);
		const diagnosticMessages = [
			...result.first.diagnostics,
			...result.second.diagnostics,
		].map((diagnostic) => diagnostic.message);
		expect(diagnosticMessages.slice(0, 2)).toEqual([
			"plugin is not granted capability use",
			"plugin did not declare capability use",
		]);
		expect(diagnosticMessages[2]?.startsWith("SchemaError")).toBe(true);
	});
});
