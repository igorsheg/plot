import { describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import {
	interruptWork,
	sourceId,
	PlotLoopError,
	setFact,
	subjectKey,
	workKey,
} from "../src/domain.js";
import { makeOrchestratorLayer, Orchestrator } from "../src/loop.js";
import type { WorkRunner } from "../src/runner.js";
import type { WorkSource } from "../src/source.js";

const succeedRunner = (calls: string[] = []): WorkRunner => ({
	run: ({ work }) =>
		Effect.sync(() => {
			calls.push(String(work.workKey));
			return { output: work.templateContext };
		}),
});

const runWith = <A>(
	sources: readonly WorkSource[],
	effect: Effect.Effect<A, never, Orchestrator>,
	runner: WorkRunner = succeedRunner(),
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(
				makeOrchestratorLayer({
					sources,
					runner,
				}),
			),
		),
	);

const makeWorkSource = (id: string, key: string): WorkSource => ({
	id: sourceId(id),
	selectWork: () => Effect.succeed([{ workKey: workKey(key) }]),
});

describe("task-agnostic Plot loop", () => {
	test("setup rejects invalid runtime config with typed loop errors", async () => {
		const error = await Effect.runPromise(
			Effect.service(Orchestrator).pipe(
				Effect.provide(
					makeOrchestratorLayer({
						sources: [],
						runner: succeedRunner(),
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

	test("reconciles observations before selecting work, and completions apply on the next reconciliation", async () => {
		const subject = subjectKey("work-1");
		const key = workKey("review:work-1:v1");
		const source: WorkSource = {
			id: sourceId("demo"),
			observeTick: () => Effect.succeed([{ type: "seen", subject }]),
			reconcile: ({ snapshot }) =>
				Effect.succeed([
					...snapshot.observations.map((observation) =>
						setFact(`seen:${observation.subject ?? "unknown"}`, true),
					),
					...snapshot.completions.map((completion) =>
						setFact(
							`completed:${completion.subject ?? "unknown"}`,
							completion.status,
						),
					),
				]),
			selectWork: ({ snapshot }) =>
				snapshot.facts.get("seen:work-1") === true &&
				!snapshot.facts.has("completed:work-1")
					? Effect.succeed([
							{
								workKey: key,
								subject,
								templateContext: { reviewed: true },
							},
						])
					: Effect.succeed([]),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				const afterFirst = yield* orchestrator.snapshot();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, afterFirst, second };
			}),
		);

		expect(result.first.selected).toHaveLength(1);
		expect(result.first.started).toHaveLength(1);
		expect(result.first.completions).toHaveLength(0);
		expect(result.afterFirst.facts.get("seen:work-1")).toBe(true);
		expect(result.afterFirst.facts.has("completed:work-1")).toBe(false);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", subject, workKey: key }),
		);
		expect(result.second.snapshot.facts.get("completed:work-1")).toBe(
			"succeeded",
		);
	});

	test("tickOnce starts long runner work without waiting for completion", async () => {
		const release = Deferred.makeUnsafe<string>();
		const key = workKey("slow:1");
		const source: WorkSource = {
			id: sourceId("slow-source"),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};
		const runner: WorkRunner = {
			run: () =>
				Deferred.await(release).pipe(Effect.map((output) => ({ output }))),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				yield* Deferred.succeed(release, "done");
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
			}),
			runner,
		);

		expect(result.first.started).toHaveLength(1);
		expect(result.first.completions).toHaveLength(0);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({
				status: "succeeded",
				workKey: key,
				output: "done",
			}),
		);
	});

	test("runner observations reenter the mailbox for source reconciliation", async () => {
		const subject = subjectKey("agent:turn:1");
		const key = workKey("agent:turn:1");
		const source: WorkSource = {
			id: sourceId("agent-source"),
			reconcile: ({ snapshot }) =>
				Effect.succeed(
					snapshot.observations.map((observation) =>
						setFact(
							`runner:${observation.subject ?? "unknown"}`,
							observation.data,
						),
					),
				),
			selectWork: ({ snapshot }) =>
				snapshot.facts.has("runner:agent:turn:1")
					? Effect.succeed([])
					: Effect.succeed([{ workKey: key, subject }]),
		};
		const runner: WorkRunner = {
			run: ({ emitObservation }) =>
				emitObservation({
					type: "runner.progress",
					data: { tokens: 12 },
				}).pipe(Effect.as({})),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				return yield* orchestrator.tickOnce();
			}),
			runner,
		);

		expect(result.snapshot.facts.get("runner:agent:turn:1")).toEqual({
			tokens: 12,
		});
	});

	test("actor run consumes queued wake sources and owns the loop", async () => {
		const subject = subjectKey("actor-work");
		const source: WorkSource = {
			id: sourceId("actor-source"),
			observeTick: () => Effect.succeed([{ type: "actor-seen", subject }]),
			reconcile: ({ snapshot }) =>
				Effect.succeed(
					snapshot.observations.map((observation) =>
						setFact(`actor:${observation.subject ?? "unknown"}`, true),
					),
				),
		};

		const result = await runWith(
			[source],
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

	test("sources select work while the runner owns inner agent execution", async () => {
		const calls: string[] = [];
		const pr = subjectKey("github:pr:42");
		const key = workKey("github:pr:plot:42:abc123");
		const source: WorkSource = {
			id: sourceId("pr-reviewer"),
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
					...snapshot.observations.map((observation) =>
						setFact(
							`ready:${observation.subject ?? "unknown"}`,
							observation.data,
						),
					),
					...snapshot.completions.map((completion) =>
						setFact(`reviewed:${completion.subject ?? "unknown"}`, true),
					),
				]),
			selectWork: ({ snapshot }) =>
				Effect.sync(() => {
					const ready = snapshot.facts.get("ready:github:pr:42");
					const reviewed = snapshot.facts.get("reviewed:github:pr:42");
					if (!ready || reviewed) return [];
					return [{ workKey: key, subject: pr, templateContext: ready }];
				}),
		};
		const runner: WorkRunner = {
			run: ({ work }) =>
				Effect.sync(() => {
					calls.push("render WORKFLOW.md prompt for PR 42");
					calls.push("start agent with gh/shell/workspace tools");
					calls.push(`agent finishes ${work.workKey}`);
					return { output: { comments: 1 } };
				}),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				const first = yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				return { first, second };
			}),
			runner,
		);

		expect(result.first.selected).toEqual([
			expect.objectContaining({ workKey: key, subject: pr }),
		]);
		expect(calls).toEqual([
			"render WORKFLOW.md prompt for PR 42",
			"start agent with gh/shell/workspace tools",
			`agent finishes ${key}`,
		]);
		expect(result.second.completions).toContainEqual(
			expect.objectContaining({ subject: pr, status: "succeeded" }),
		);
	});

	test("runtime policy gates dispatch lifecycle, not inner agent tools", async () => {
		const release = Deferred.makeUnsafe<void>();
		const runner: WorkRunner = {
			run: () =>
				Deferred.await(release).pipe(Effect.map(() => ({ output: "done" }))),
		};

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
						sources: [
							makeWorkSource("one", "work:one"),
							makeWorkSource("two", "work:two"),
						],
						runner,
						policy: { maxConcurrentRuns: 1 },
					}),
				),
			),
		);

		expect(result.first.selected).toHaveLength(2);
		expect(result.first.started).toHaveLength(1);
		expect(result.snapshot.running.has(workKey("work:one"))).toBe(true);
		expect(result.snapshot.running.has(workKey("work:two"))).toBe(false);
	});

	test("completion does not make work terminal; sources own rerun semantics", async () => {
		const calls: string[] = [];
		const key = workKey("repeatable:1");
		const source: WorkSource = {
			id: sourceId("repeatable-source"),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				const third = yield* orchestrator.tickOnce();
				return { second, third };
			}),
			succeedRunner(calls),
		);

		expect(calls).toEqual([String(key), String(key), String(key)]);
		expect(result.second.completions).toHaveLength(1);
		expect(result.second.started).toHaveLength(1);
		expect(result.third.completions).toHaveLength(1);
		expect(result.third.started).toHaveLength(1);
	});

	test("sources can interrupt running work without owning runner fibers", async () => {
		const started = Deferred.makeUnsafe<void>();
		const interrupted = Deferred.makeUnsafe<void>();
		const key = workKey("cancel:1");
		let shouldInterrupt = false;
		const source: WorkSource = {
			id: sourceId("cancel-source"),
			reconcile: ({ snapshot }) =>
				shouldInterrupt
					? Effect.succeed(
							[...snapshot.running.keys()].map((runningKey) =>
								interruptWork(runningKey, "source marked work ineligible"),
							),
						)
					: Effect.succeed([]),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};
		const runner: WorkRunner = {
			run: () =>
				Effect.gen(function* () {
					yield* Deferred.succeed(started, undefined);
					return yield* Effect.never;
				}).pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.tickOnce();
				yield* Deferred.await(started);
				shouldInterrupt = true;
				const second = yield* orchestrator.tickOnce();
				yield* Deferred.await(interrupted);
				const after = yield* orchestrator.snapshot();
				return { second, after };
			}),
			runner,
		);

		expect(result.second.completions).toContainEqual(
			expect.objectContaining({
				workKey: key,
				status: "interrupted",
			}),
		);
		expect(result.second.started).toHaveLength(0);
		expect(result.after.running.has(key)).toBe(false);
	});

	test("shutdown interrupts active runner work and clears running claims", async () => {
		const started = Deferred.makeUnsafe<void>();
		const interrupted = Deferred.makeUnsafe<void>();
		const key = workKey("shutdown:1");
		const source: WorkSource = {
			id: sourceId("shutdown-source"),
			reconcile: ({ snapshot }) =>
				Effect.succeed(
					snapshot.completions.map((completion) =>
						setFact(`completion:${completion.workKey}`, completion.status),
					),
				),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};
		const runner: WorkRunner = {
			run: () =>
				Effect.gen(function* () {
					yield* Deferred.succeed(started, undefined);
					return yield* Effect.never;
				}).pipe(Effect.ensuring(Deferred.succeed(interrupted, undefined))),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.start();
				yield* orchestrator.offer({ type: "tick" });
				yield* Deferred.await(started);
				yield* Effect.yieldNow;
				const before = yield* orchestrator.snapshot();
				yield* orchestrator.shutdown();
				yield* Deferred.await(interrupted);
				yield* Effect.yieldNow;
				const after = yield* orchestrator.snapshot();
				return { before, after };
			}),
			runner,
		);

		expect(result.before.running.has(key)).toBe(true);
		expect(result.after.running.has(key)).toBe(false);
		expect(result.after.facts.get("completion:shutdown:1")).toBe("interrupted");
	});

	test("failed runner work becomes a completion and diagnostic", async () => {
		const key = workKey("broken:1");
		const source: WorkSource = {
			id: sourceId("broken-source"),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};
		const runner: WorkRunner = {
			run: () => Effect.fail("boom"),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const orchestrator = yield* Orchestrator;
				yield* orchestrator.tickOnce();
				yield* Effect.yieldNow;
				return yield* orchestrator.tickOnce();
			}),
			runner,
		);

		expect(result.completions).toContainEqual(
			expect.objectContaining({
				sourceId: source.id,
				workKey: key,
				status: "failed",
			}),
		);
		expect(result.diagnostics[0]).toEqual(
			expect.objectContaining({
				sourceId: source.id,
				workKey: key,
				phase: "act",
				level: "error",
			}),
		);
	});
});
