import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Stream } from "effect";
import {
	interruptWork,
	scheduleWake,
	sourceId,
	PlotAgentError,
	setFact,
	subjectKey,
	workKey,
} from "../src/model.js";
import {
	makePlotAgentLayer,
	PlotAgent,
	type PlotAgentLayerOptions,
} from "../src/agent.js";
import type { WorkRunner } from "../src/work-runner.js";
import type { WorkSource } from "../src/work-source.js";

const succeedRunner = (calls: string[] = []): WorkRunner => ({
	run: ({ work }) =>
		Effect.sync(() => {
			calls.push(String(work.workKey));
			return { output: work.templateContext };
		}),
});

const runWith = <A>(
	sources: readonly WorkSource[],
	effect: Effect.Effect<A, never, PlotAgent>,
	runner: WorkRunner = succeedRunner(),
	options: Omit<PlotAgentLayerOptions, "sources" | "runner"> = {},
) =>
	Effect.runPromise(
		effect.pipe(
			Effect.provide(
				makePlotAgentLayer({
					...options,
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

describe("task-agnostic Plot agent", () => {
	test("setup rejects invalid runtime config with typed agent errors", async () => {
		const error = await Effect.runPromise(
			Effect.service(PlotAgent).pipe(
				Effect.provide(
					makePlotAgentLayer({
						sources: [],
						runner: succeedRunner(),
						queueCapacity: 0,
					}),
				),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PlotAgentError);
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
				const plotAgent = yield* PlotAgent;
				const first = yield* plotAgent.tickOnce();
				const afterFirst = yield* plotAgent.snapshot();
				yield* Effect.yieldNow;
				const second = yield* plotAgent.tickOnce();
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
				const plotAgent = yield* PlotAgent;
				const first = yield* plotAgent.tickOnce();
				yield* Deferred.succeed(release, "done");
				yield* Effect.yieldNow;
				const second = yield* plotAgent.tickOnce();
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.tickOnce();
				yield* Effect.yieldNow;
				return yield* plotAgent.tickOnce();
			}),
			runner,
		);

		expect(result.snapshot.facts.get("runner:agent:turn:1")).toEqual({
			tokens: 12,
		});
	});

	test("actor run schedules periodic ticks when cadence is configured", async () => {
		let observations = 0;
		const secondTick = Deferred.makeUnsafe<number>();
		const source: WorkSource = {
			id: sourceId("cadence-source"),
			observeTick: () =>
				Effect.gen(function* () {
					observations += 1;
					if (observations === 2) {
						yield* Deferred.succeed(secondTick, observations);
					}
					return [{ type: "cadence" }];
				}),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.start();
				const count = yield* Deferred.await(secondTick);
				yield* plotAgent.shutdown();
				return count;
			}),
			succeedRunner(),
			{ tickIntervalMs: 1 },
		);

		expect(result).toBe(2);
	});

	test("sources can schedule delayed generic wakeups", async () => {
		let ticks = 0;
		const secondTick = Deferred.makeUnsafe<number>();
		const source: WorkSource = {
			id: sourceId("wake-source"),
			observeTick: () =>
				Effect.gen(function* () {
					ticks += 1;
					if (ticks === 2) {
						yield* Deferred.succeed(secondTick, ticks);
					}
					return [{ type: "wake" }];
				}),
			reconcile: () =>
				ticks === 1
					? Effect.succeed([scheduleWake(1, "retry later")])
					: Effect.succeed([]),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.start();
				yield* plotAgent.offer({ type: "tick" });
				const count = yield* Deferred.await(secondTick);
				yield* plotAgent.shutdown();
				return count;
			}),
		);

		expect(result).toBe(2);
	});

	test("actor run consumes queued wake sources and owns the agent", async () => {
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.start();
				yield* plotAgent.offer({ type: "tick" });
				yield* plotAgent.shutdown();
				yield* Effect.yieldNow;
				return yield* plotAgent.snapshot();
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
				const plotAgent = yield* PlotAgent;
				const first = yield* plotAgent.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* plotAgent.tickOnce();
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
				const plotAgent = yield* PlotAgent;
				const first = yield* plotAgent.tickOnce();
				const snapshot = yield* plotAgent.snapshot();
				yield* Deferred.succeed(release, undefined);
				return { first, snapshot };
			}).pipe(
				Effect.provide(
					makePlotAgentLayer({
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

	test("per-source concurrency caps dispatch independently of global capacity", async () => {
		const release = Deferred.makeUnsafe<void>();
		const sourceOne: WorkSource = {
			id: sourceId("source-one"),
			policy: { maxConcurrentRuns: 1 },
			selectWork: () =>
				Effect.succeed([
					{ workKey: workKey("one:1") },
					{ workKey: workKey("one:2") },
				]),
		};
		const sourceTwo: WorkSource = {
			id: sourceId("source-two"),
			policy: { maxConcurrentRuns: 2 },
			selectWork: () =>
				Effect.succeed([
					{ workKey: workKey("two:1") },
					{ workKey: workKey("two:2") },
				]),
		};
		const runner: WorkRunner = {
			run: () => Deferred.await(release).pipe(Effect.as({})),
		};

		const result = await runWith(
			[sourceOne, sourceTwo],
			Effect.gen(function* () {
				const plotAgent = yield* PlotAgent;
				const first = yield* plotAgent.tickOnce();
				const snapshot = yield* plotAgent.snapshot();
				yield* Deferred.succeed(release, undefined);
				return { first, snapshot };
			}),
			runner,
			{ policy: { maxConcurrentRuns: 10 } },
		);

		expect(result.first.selected).toHaveLength(4);
		expect(result.first.started).toHaveLength(3);
		expect(
			result.first.started.filter((run) => run.sourceId === sourceOne.id),
		).toHaveLength(1);
		expect(
			result.first.started.filter((run) => run.sourceId === sourceTwo.id),
		).toHaveLength(2);
		expect(result.snapshot.running.size).toBe(3);
	});

	test("setup rejects invalid per-source concurrency caps", async () => {
		const error = await Effect.runPromise(
			Effect.service(PlotAgent).pipe(
				Effect.provide(
					makePlotAgentLayer({
						sources: [
							{
								id: sourceId("bad-source"),
								policy: { maxConcurrentRuns: 0 },
							},
						],
						runner: succeedRunner(),
					}),
				),
				Effect.flip,
			),
		);

		expect(error).toBeInstanceOf(PlotAgentError);
		expect(error.phase).toBe("setup");
		expect(error.message).toBe(
			"source bad-source maxConcurrentRuns must be a positive integer",
		);
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.tickOnce();
				yield* Effect.yieldNow;
				const second = yield* plotAgent.tickOnce();
				yield* Effect.yieldNow;
				const third = yield* plotAgent.tickOnce();
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.tickOnce();
				yield* Deferred.await(started);
				shouldInterrupt = true;
				const second = yield* plotAgent.tickOnce();
				yield* Deferred.await(interrupted);
				const after = yield* plotAgent.snapshot();
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

	test("runtime snapshot keeps bounded diagnostics history", async () => {
		const source: WorkSource = {
			id: sourceId("noisy-source"),
			selectWork: () => Effect.fail("too loud"),
		};

		const result = await runWith(
			[source],
			Effect.gen(function* () {
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.tickOnce();
				yield* plotAgent.tickOnce();
				yield* plotAgent.tickOnce();
				return yield* plotAgent.snapshot();
			}),
			succeedRunner(),
			{ historyLimit: 2 },
		);

		expect(result.diagnostics).toHaveLength(2);
		expect(result.diagnostics.every((item) => item.phase === "select")).toBe(
			true,
		);
	});

	test("run watchdog times out active runner work", async () => {
		const started = Deferred.makeUnsafe<void>();
		const interrupted = Deferred.makeUnsafe<void>();
		const key = workKey("timeout:1");
		const source: WorkSource = {
			id: sourceId("timeout-source"),
			reconcile: ({ snapshot }) =>
				Effect.succeed(
					snapshot.completions.map((completion) =>
						setFact(`completion:${completion.workKey}`, completion.status),
					),
				),
			selectWork: ({ snapshot }) =>
				snapshot.facts.has("completion:timeout:1")
					? Effect.succeed([])
					: Effect.succeed([{ workKey: key }]),
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.start();
				yield* plotAgent.offer({ type: "tick" });
				yield* Deferred.await(started);
				yield* Deferred.await(interrupted);
				yield* Effect.yieldNow;
				const snapshot = yield* plotAgent.snapshot();
				yield* plotAgent.shutdown();
				return snapshot;
			}),
			runner,
			{ maxRunDurationMs: 1 },
		);

		expect(result.running.has(key)).toBe(false);
		expect(result.facts.get("completion:timeout:1")).toBe("timed_out");
	});

	test("status subscribers receive operator-visible agent events", async () => {
		const key = workKey("event:1");
		const source: WorkSource = {
			id: sourceId("event-source"),
			selectWork: () => Effect.succeed([{ workKey: key }]),
		};

		const result = await runWith(
			[source],
			Effect.scoped(
				Effect.gen(function* () {
					const plotAgent = yield* PlotAgent;
					const fiber = yield* plotAgent
						.events()
						.pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* plotAgent.tickOnce();
					const events = yield* Fiber.join(fiber);
					return events.map((event) => event.type);
				}),
			),
		);

		expect(result).toEqual(["tick_started", "work_started", "tick_completed"]);
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.start();
				yield* plotAgent.offer({ type: "tick" });
				yield* Deferred.await(started);
				yield* Effect.yieldNow;
				const before = yield* plotAgent.snapshot();
				yield* plotAgent.shutdown();
				yield* Deferred.await(interrupted);
				yield* Effect.yieldNow;
				const after = yield* plotAgent.snapshot();
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
				const plotAgent = yield* PlotAgent;
				yield* plotAgent.tickOnce();
				yield* Effect.yieldNow;
				return yield* plotAgent.tickOnce();
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
