import { describe, expect, test } from "bun:test";
import {
	interruptWork,
	removeWork,
	scheduleWake,
	PlotAgentError,
	upsertWork,
	setFact,
} from "../src/model.js";
import {
	makePlotAgentLayer,
	type PlotAgentLayerOptions,
} from "../src/agent.js";
import type { WorkRunner } from "../src/work-runner.js";
import type { WorkSource } from "../src/work-source.js";

const deferred = <A>() => {
	let resolve!: (value: A) => void;
	const promise = new Promise<A>((r) => {
		resolve = r;
	});
	return { promise, resolve };
};
const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));
const never = <A>() => new Promise<A>(() => {});
const waitForEvent = async <A>(
	iterable: AsyncIterable<A>,
	predicate: (item: A) => boolean,
) => {
	const iterator = iterable[Symbol.asyncIterator]();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const nextMatching = (async () => {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop -- helper polls until the requested event arrives.
				const next = await iterator.next();
				if (next.done) break;
				if (predicate(next.value)) return next.value;
			}
			throw new Error("event stream ended before matching event");
		})();
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(
				() => reject(new Error("timed out waiting for matching event")),
				1000,
			);
		});
		return await Promise.race([nextMatching, timedOut]);
	} finally {
		if (timeout) clearTimeout(timeout);
		await iterator.return?.();
	}
};
const collectN = async <A>(iterable: AsyncIterable<A>, n: number) => {
	const out: A[] = [];
	for await (const item of iterable) {
		out.push(item);
		if (out.length >= n) break;
	}
	return out;
};

const succeedRunner = (calls: string[] = []): WorkRunner => ({
	run: ({ work }) => {
		calls.push(String(work.workKey));
		return { output: work.templateContext };
	},
});

const makeAgent = (
	sources: WorkSource[],
	runner: WorkRunner = succeedRunner(),
	options: Omit<PlotAgentLayerOptions, "sources" | "runner"> = {},
) => makePlotAgentLayer({ ...options, sources, runner });

const makeWorkSource = (id: string, key: string): WorkSource => ({
	id: id,
	selectWork: () => [{ workKey: key }],
});

describe("task-agnostic Plot agent", () => {
	test("setup rejects invalid runtime config with typed agent errors", async () => {
		let error: unknown;
		try {
			makeAgent([], succeedRunner(), { queueCapacity: 0 });
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(PlotAgentError);
		expect((error as PlotAgentError).phase).toBe("setup");
		expect((error as Error).message).toBe(
			"queueCapacity must be a positive integer",
		);
	});

	test("reconciles observations before selecting work, and completions apply on the next reconciliation", async () => {
		const subject = "work-1";
		const key = "review:work-1:v1";
		const source: WorkSource = {
			id: "demo",
			observeTick: () => [{ type: "seen", subject }],
			reconcile: ({ snapshot }) => [
				...snapshot.observations.map((observation) =>
					setFact(`seen:${observation.subject ?? "unknown"}`, true),
				),
				...snapshot.completions.map((completion) =>
					setFact(
						`completed:${completion.subject ?? "unknown"}`,
						completion.status,
					),
				),
			],
			selectWork: ({ snapshot }) =>
				snapshot.facts.get("seen:work-1") === true &&
				!snapshot.facts.has("completed:work-1")
					? [{ workKey: key, subject, templateContext: { reviewed: true } }]
					: [],
		};
		const agent = makeAgent([source]);
		const first = await agent.tickOnce();
		const afterFirst = await agent.snapshot();
		await yieldNow();
		const second = await agent.tickOnce();
		expect(first.selected).toHaveLength(1);
		expect(first.started).toHaveLength(1);
		expect(first.completions).toHaveLength(0);
		expect(afterFirst.facts.get("seen:work-1")).toBe(true);
		expect(afterFirst.facts.has("completed:work-1")).toBe(false);
		expect(second.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", subject, workKey: key }),
		);
		expect(second.snapshot.facts.get("completed:work-1")).toBe("succeeded");
	});

	test("tickOnce starts long runner work without waiting for completion", async () => {
		const release = deferred<string>();
		const key = "slow:1";
		const source: WorkSource = {
			id: "slow-source",
			selectWork: () => [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: async () => ({ output: await release.promise }),
		};
		const agent = makeAgent([source], runner);
		const first = await agent.tickOnce();
		release.resolve("done");
		await yieldNow();
		const second = await agent.tickOnce();
		expect(first.started).toHaveLength(1);
		expect(first.completions).toHaveLength(0);
		expect(second.completions).toContainEqual(
			expect.objectContaining({
				status: "succeeded",
				workKey: key,
				output: "done",
			}),
		);
	});

	test("runner observations reenter the mailbox for source reconciliation", async () => {
		const subject = "agent:turn:1";
		const key = "agent:turn:1";
		const source: WorkSource = {
			id: "agent-source",
			reconcile: ({ snapshot }) =>
				snapshot.observations.map((observation) =>
					setFact(
						`runner:${observation.subject ?? "unknown"}`,
						observation.data,
					),
				),
			selectWork: ({ snapshot }) =>
				snapshot.facts.has("runner:agent:turn:1")
					? []
					: [{ workKey: key, subject }],
		};
		const runner: WorkRunner = {
			run: async ({ emitObservation }) => {
				await emitObservation({
					type: "runner.progress",
					data: { tokens: 12 },
				});
				return {};
			},
		};
		const agent = makeAgent([source], runner);
		await agent.tickOnce();
		await yieldNow();
		const result = await agent.tickOnce();
		expect(result.snapshot.facts.get("runner:agent:turn:1")).toEqual({
			tokens: 12,
		});
	});

	test("actor run schedules periodic ticks when cadence is configured", async () => {
		let observations = 0;
		const secondTick = deferred<number>();
		const source: WorkSource = {
			id: "cadence-source",
			observeTick: () => {
				observations += 1;
				if (observations === 2) secondTick.resolve(observations);
				return [{ type: "cadence" }];
			},
		};
		const agent = makeAgent([source], succeedRunner(), { tickIntervalMs: 1 });
		await agent.start();
		const count = await secondTick.promise;
		await agent.shutdown();
		expect(count).toBe(2);
	});

	test("sources can schedule delayed generic wakeups", async () => {
		let ticks = 0;
		const secondTick = deferred<number>();
		const source: WorkSource = {
			id: "wake-source",
			observeTick: () => {
				ticks += 1;
				if (ticks === 2) secondTick.resolve(ticks);
				return [];
			},
			reconcile: () =>
				ticks === 1
					? [
							scheduleWake(50, {
								reason: "retry later",
								workKey: "wake-source:item:1",
								attempt: 4,
							}),
						]
					: [],
		};
		const agent = makeAgent([source]);
		const wakeScheduled = waitForEvent(
			agent.events(),
			(event) =>
				event.type === "wake_scheduled" &&
				event.reason === "retry later" &&
				event.workKey === "wake-source:item:1" &&
				event.attempt === 4,
		);
		await agent.start();
		await agent.offer({ type: "tick" });
		await wakeScheduled;
		expect((await agent.snapshot()).scheduledWakes).toEqual([
			{
				dueAtMs: expect.any(Number),
				delayMs: 50,
				reason: "retry later",
				workKey: "wake-source:item:1",
				attempt: 4,
			},
		]);
		const count = await secondTick.promise;
		await agent.shutdown();
		expect(count).toBe(2);
	});

	test("actor run consumes queued wake sources and owns the agent", async () => {
		const subject = "actor:1";
		const source: WorkSource = {
			id: "actor-source",
			observeTick: () => [{ type: "actor-seen", subject }],
			reconcile: ({ snapshot }) =>
				snapshot.observations.map((o) => setFact(`seen:${o.subject}`, true)),
		};
		const agent = makeAgent([source]);
		const completed = waitForEvent(
			agent.events(),
			(event) => event.type === "tick_completed",
		);
		await agent.start();
		await agent.offer({ type: "tick" });
		await completed;
		await agent.shutdown();
		await yieldNow();
		const snapshot = await agent.snapshot();
		expect(snapshot.facts.get("seen:actor:1")).toBe(true);
	});

	test("sources select work while the runner owns inner agent execution", async () => {
		const ready = { provider: "anthropic", model: "claude-opus-4-8" };
		const pr = "github:acme/web:pr:42";
		const key = "review:github:acme/web:pr:42:sha-1";
		const calls: unknown[] = [];
		const source: WorkSource = {
			id: "github",
			reconcile: () => [setFact("ready", ready)],
			selectWork: ({ snapshot }) =>
				snapshot.facts.get("ready")
					? [{ workKey: key, subject: pr, templateContext: ready }]
					: [],
		};
		const runner: WorkRunner = {
			run: ({ work }) => {
				calls.push(work.templateContext);
				return {};
			},
		};
		const agent = makeAgent([source], runner);
		const first = await agent.tickOnce();
		await yieldNow();
		const second = await agent.tickOnce();
		expect(first.started).toHaveLength(1);
		expect(second.completions).toContainEqual(
			expect.objectContaining({ workKey: key, status: "succeeded" }),
		);
		expect(calls).toContainEqual(ready);
	});

	test("runtime policy gates dispatch lifecycle, not inner agent tools", async () => {
		const release = deferred<void>();
		const source = makeWorkSource("policy-source", "policy:1");
		const runner: WorkRunner = {
			run: async () => {
				await release.promise;
				return { output: "done" };
			},
		};
		const agent = makeAgent([source], runner, {
			policy: { maxConcurrentRuns: 1 },
		});
		const first = await agent.tickOnce();
		const snapshot = await agent.snapshot();
		release.resolve();
		expect(first.started).toHaveLength(1);
		expect(snapshot.running.size).toBe(1);
	});

	test("per-source concurrency caps dispatch independently of global capacity", async () => {
		const release = deferred<void>();
		const slow = "aaa-slow";
		const fast = "fast";
		const sourceA: WorkSource = {
			id: "a",
			policy: { maxConcurrentRuns: 1 },
			selectWork: () => [{ workKey: slow }, { workKey: "blocked" }],
		};
		const sourceB: WorkSource = {
			id: "b",
			selectWork: () => [{ workKey: fast }],
		};
		const runner: WorkRunner = {
			run: async ({ work }) =>
				work.workKey === slow ? (await release.promise, {}) : {},
		};
		const agent = makeAgent([sourceA, sourceB], runner, {
			policy: { maxConcurrentRuns: 3 },
		});
		const first = await agent.tickOnce();
		release.resolve();
		expect(first.started.map((r) => r.workKey)).toEqual([slow, fast]);
	});

	test("setup rejects invalid per-source concurrency caps", async () => {
		let error: unknown;
		try {
			makeAgent([{ id: "bad-source", policy: { maxConcurrentRuns: 0 } }]);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(PlotAgentError);
		expect((error as PlotAgentError).phase).toBe("setup");
		expect((error as Error).message).toContain("maxConcurrentRuns");
	});

	test("completion does not make work terminal; sources own rerun semantics", async () => {
		const key = "rerun:1";
		const source: WorkSource = {
			id: "rerun",
			selectWork: () => [{ workKey: key }],
		};
		const agent = makeAgent([source]);
		await agent.tickOnce();
		await yieldNow();
		const second = await agent.tickOnce();
		expect(second.completions).toHaveLength(1);
		expect(second.started).toHaveLength(1);
	});

	test("sources can interrupt running work without owning runner fibers", async () => {
		const key = "interrupt:1";
		const started = deferred<void>();
		const interrupted = deferred<void>();
		let shouldInterrupt = false;
		const source: WorkSource = {
			id: "interrupt-source",
			reconcile: () => (shouldInterrupt ? [interruptWork(key, "stop")] : []),
			selectWork: () => [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: ({ signal }) => {
				started.resolve();
				signal.addEventListener("abort", () => interrupted.resolve(), {
					once: true,
				});
				return never();
			},
		};
		const agent = makeAgent([source], runner);
		await agent.tickOnce();
		await started.promise;
		shouldInterrupt = true;
		const second = await agent.tickOnce();
		await interrupted.promise;
		const after = await agent.snapshot();
		expect(second.completions).toContainEqual(
			expect.objectContaining({ status: "interrupted", workKey: key }),
		);
		expect(after.running.has(key)).toBe(false);
	});

	test("reconciliation cannot erase active running claims", async () => {
		const subject = "claim:1";
		const key = "claim:1";
		let discovered = true;
		const source: WorkSource = {
			id: "claim-source",
			reconcile: () =>
				discovered
					? [
							upsertWork({
								workKey: key,
								sourceId: "claim-source",
								status: "pending",
								subject,
							}),
						]
					: [removeWork(key)],
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) ? [] : [{ workKey: key, subject }],
		};
		const agent = makeAgent([source], { run: () => never() });
		const first = await agent.tickOnce();
		const run = first.started[0]!;
		const observedRunning = waitForEvent(
			agent.events(),
			(event) =>
				event.type === "work_observed" &&
				event.work.workKey === key &&
				event.work.status === "running" &&
				event.work.currentRunId === run.runId,
		);

		const second = await agent.tickOnce();
		await observedRunning;
		discovered = false;
		const third = await agent.tickOnce();

		expect(second.snapshot.work.get(key)).toEqual(
			expect.objectContaining({
				status: "running",
				currentRunId: run.runId,
			}),
		);
		expect(third.snapshot.work.get(key)).toEqual(
			expect.objectContaining({
				status: "running",
				currentRunId: run.runId,
			}),
		);
		expect(third.snapshot.running.has(key)).toBe(true);
		await agent.shutdown();
	});

	test("reconciliation can release active work when interrupting it", async () => {
		const key = "release:1";
		let release = false;
		const source: WorkSource = {
			id: "release-source",
			reconcile: () =>
				release ? [interruptWork(key, "gone"), removeWork(key)] : [],
			selectWork: ({ snapshot }) =>
				release || snapshot.running.has(key) ? [] : [{ workKey: key }],
		};
		const agent = makeAgent([source], { run: () => never() });
		await agent.tickOnce();
		release = true;

		const second = await agent.tickOnce();

		expect(second.completions).toContainEqual(
			expect.objectContaining({ status: "interrupted", workKey: key }),
		);
		expect(second.snapshot.work.has(key)).toBe(false);
		expect(second.snapshot.running.has(key)).toBe(false);
		await agent.shutdown();
	});

	test("reconciliation can mark active superseded work as draining", async () => {
		const key = "drain:1";
		let draining = false;
		const source: WorkSource = {
			id: "drain-source",
			reconcile: () => [
				upsertWork({
					workKey: key,
					sourceId: "drain-source",
					status: draining ? "draining" : "pending",
				}),
			],
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) ? [] : [{ workKey: key }],
		};
		const agent = makeAgent([source], { run: () => never() });
		const first = await agent.tickOnce();
		const run = first.started[0]!;
		draining = true;

		const second = await agent.tickOnce();

		expect(second.snapshot.work.get(key)).toEqual(
			expect.objectContaining({
				status: "draining",
				currentRunId: run.runId,
			}),
		);
		expect(second.snapshot.running.has(key)).toBe(true);
		await agent.shutdown();
	});

	test("runtime snapshot keeps bounded diagnostics history", async () => {
		const source: WorkSource = {
			id: "diagnostic-source",
			selectWork: () => {
				throw new Error("too loud");
			},
		};
		const agent = makeAgent([source], succeedRunner(), { historyLimit: 2 });
		await agent.tickOnce();
		await agent.tickOnce();
		await agent.tickOnce();
		const snapshot = await agent.snapshot();
		expect(snapshot.diagnostics).toHaveLength(2);
		expect(
			snapshot.diagnostics.every((item) => item.message === "too loud"),
		).toBe(true);
	});

	test("run watchdog times out active runner work", async () => {
		const key = "timeout:1";
		const started = deferred<void>();
		const source: WorkSource = {
			id: "timeout-source",
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) ? [] : [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: ({ signal }) => {
				started.resolve();
				signal.addEventListener("abort", () => {}, { once: true });
				return never();
			},
		};
		const agent = makeAgent([source], runner, { maxRunDurationMs: 1 });
		const completed = (async () => {
			for await (const event of agent.events()) {
				if (event.type === "attempt_completed") return event.completion;
			}
			return undefined;
		})();
		await agent.start();
		await agent.offer({ type: "tick" });
		await started.promise;
		await new Promise((r) => setTimeout(r, 5));
		const completion = await completed;
		await agent.shutdown();
		expect(completion?.status).toBe("timed_out");
	});

	test("status subscribers receive operator-visible agent events", async () => {
		const key = "status:1";
		const source: WorkSource = {
			id: "status-source",
			selectWork: () => [{ workKey: key }],
		};
		const agent = makeAgent([source]);
		const pending = collectN(agent.events(), 3);
		await Promise.resolve();
		await agent.tickOnce();
		const events = await pending;
		expect(events.map((event) => event.type)).toEqual([
			"tick_started",
			"attempt_started",
			"tick_completed",
		]);
	});

	test("shutdown aborts the active tick and closes the event stream", async () => {
		const entered = deferred<void>();
		const aborted = deferred<void>();
		const source: WorkSource = {
			id: "shutdown-hook",
			observeTick: ({ signal }) => {
				entered.resolve();
				return new Promise<[]>((resolve) => {
					signal.addEventListener(
						"abort",
						() => {
							aborted.resolve();
							resolve([]);
						},
						{ once: true },
					);
				});
			},
		};
		const agent = makeAgent([source], succeedRunner(), {
			tickIntervalMs: 60_000,
		});
		const seen: string[] = [];
		const drained = (async () => {
			for await (const event of agent.events()) seen.push(event.type);
		})();

		await agent.start();
		await entered.promise;
		await agent.shutdown();
		await aborted.promise;
		await drained;

		expect(seen).toEqual(["tick_started"]);
		expect(await agent.offer({ type: "tick" })).toBe(false);
	});

	test("shutdown does not wait for hooks that ignore abort", async () => {
		const entered = deferred<void>();
		const source: WorkSource = {
			id: "shutdown-stuck-hook",
			observeTick: () => {
				entered.resolve();
				return never();
			},
		};
		const agent = makeAgent([source], succeedRunner(), {
			tickIntervalMs: 60_000,
		});

		await agent.start();
		await entered.promise;
		const result = await Promise.race([
			agent.shutdown().then(() => "stopped" as const),
			new Promise<"timed_out">((resolve) =>
				setTimeout(() => resolve("timed_out"), 50),
			),
		]);

		expect(result).toBe("stopped");
		expect(await agent.offer({ type: "tick" })).toBe(false);
	});

	test("shutdown interrupts active runner work and clears running claims", async () => {
		const key = "shutdown:1";
		const started = deferred<void>();
		const interrupted = deferred<void>();
		const source: WorkSource = {
			id: "shutdown-source",
			selectWork: () => [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: ({ signal }) => {
				started.resolve();
				signal.addEventListener("abort", () => interrupted.resolve(), {
					once: true,
				});
				return never();
			},
		};
		const agent = makeAgent([source], runner);
		await agent.start();
		await agent.offer({ type: "tick" });
		await started.promise;
		await yieldNow();
		const before = await agent.snapshot();
		await agent.shutdown();
		await interrupted.promise;
		await yieldNow();
		const after = await agent.snapshot();
		expect(before.running.has(key)).toBe(true);
		expect(after.running.has(key)).toBe(false);
	});

	test("failed runner work becomes a completion and diagnostic", async () => {
		const key = "fail:1";
		const source: WorkSource = {
			id: "fail-source",
			selectWork: () => [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: () => {
				throw new Error("boom");
			},
		};
		const agent = makeAgent([source], runner);
		await agent.tickOnce();
		await yieldNow();
		const result = await agent.tickOnce();
		expect(result.completions).toContainEqual(
			expect.objectContaining({ status: "failed", workKey: key }),
		);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ level: "error", workKey: key }),
		);
	});

	test("run lifecycle messages survive a saturated mailbox", async () => {
		const key = "chatty:1";
		const doneFact = "chatty:done";
		const source: WorkSource = {
			id: "chatty",
			reconcile: ({ snapshot }) =>
				snapshot.completions.some((completion) => completion.workKey === key)
					? [setFact(doneFact, true)]
					: [],
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) || snapshot.facts.get(doneFact) === true
					? []
					: [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: async ({ emitObservation }) => {
				for (let i = 0; i < 16; i++) {
					// eslint-disable-next-line no-await-in-loop -- test needs ordered mailbox pressure.
					await emitObservation({ type: "noise", data: i });
				}
				return {};
			},
		};
		const agent = makeAgent([source], runner, { queueCapacity: 2 });
		await agent.tickOnce();
		await yieldNow();
		const result = await agent.tickOnce();
		expect(result.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", workKey: key }),
		);
		expect(result.snapshot.running.has(key)).toBe(false);
	});

	test("sources own retry and backoff decisions from completions", async () => {
		const key = "flaky:1";
		const failedFact = "flaky:failed";
		const doneFact = "flaky:done";
		let retryAllowed = false;
		let runs = 0;
		const source: WorkSource = {
			id: "flaky",
			reconcile: ({ snapshot }) =>
				snapshot.completions.flatMap((completion) => {
					if (completion.workKey !== key) return [];
					if (completion.status === "failed")
						return [
							setFact(failedFact, true),
							scheduleWake(20, {
								reason: "source retry",
								workKey: key,
								attempt: 1,
							}),
						];
					if (completion.status === "succeeded")
						return [setFact(doneFact, true)];
					return [];
				}),
			selectWork: ({ snapshot }) => {
				if (snapshot.running.has(key) || snapshot.facts.get(doneFact) === true)
					return [];
				if (snapshot.facts.get(failedFact) === true && !retryAllowed) return [];
				return [{ workKey: key }];
			},
		};
		const runner: WorkRunner = {
			run: () => {
				runs += 1;
				if (runs === 1) throw new Error("boom");
				return {};
			},
		};
		const agent = makeAgent([source], runner);
		await agent.tickOnce();
		await yieldNow();
		const second = await agent.tickOnce();
		expect(second.completions).toContainEqual(
			expect.objectContaining({ status: "failed", workKey: key }),
		);
		expect(second.started).toHaveLength(0);
		expect(second.snapshot.scheduledWakes).toContainEqual(
			expect.objectContaining({ reason: "source retry", workKey: key }),
		);

		retryAllowed = true;
		const third = await agent.tickOnce();
		expect(third.started).toHaveLength(1);
		await yieldNow();
		const fourth = await agent.tickOnce();
		expect(fourth.completions).toContainEqual(
			expect.objectContaining({ status: "succeeded", workKey: key }),
		);
		expect(fourth.started).toHaveLength(0);
	});

	test("stalled runs are interrupted after the inactivity timeout", async () => {
		const key = "stalls:1";
		let selected = false;
		const source: WorkSource = {
			id: "stalls",
			selectWork: ({ snapshot }) => {
				if (selected || snapshot.running.has(key)) return [];
				selected = true;
				return [{ workKey: key }];
			},
		};
		const runner: WorkRunner = { run: () => never() };
		const agent = makeAgent([source], runner, { stallTimeoutMs: 5 });
		await agent.tickOnce();
		await new Promise((resolve) => setTimeout(resolve, 15));
		const second = await agent.tickOnce();
		expect(second.completions).toContainEqual(
			expect.objectContaining({
				status: "timed_out",
				workKey: key,
				error: expect.stringContaining("stalled"),
			}),
		);
		expect(second.snapshot.running.has(key)).toBe(false);
	});

	test("stall timeout wakes the actor instead of waiting for poll cadence", async () => {
		const key = "stall-wake:1";
		const source: WorkSource = {
			id: "stall-wake",
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) ? [] : [{ workKey: key }],
		};
		const agent = makeAgent(
			[source],
			{ run: () => never() },
			{
				stallTimeoutMs: 5,
				tickIntervalMs: 60_000,
			},
		);
		const completed = waitForEvent(
			agent.events(),
			(event) =>
				event.type === "attempt_completed" && event.completion.workKey === key,
		);
		await agent.start();
		const event = await completed;
		await agent.shutdown();
		expect(event).toEqual(
			expect.objectContaining({
				type: "attempt_completed",
				completion: expect.objectContaining({ status: "timed_out" }),
			}),
		);
	});

	test("emitted observations keep an active run alive past the stall timeout", async () => {
		const key = "alive:1";
		const source: WorkSource = {
			id: "alive",
			selectWork: ({ snapshot }) =>
				snapshot.running.has(key) ? [] : [{ workKey: key }],
		};
		const runner: WorkRunner = {
			run: async ({ emitObservation, signal }) => {
				for (;;) {
					if (signal.aborted) return {};
					// eslint-disable-next-line no-await-in-loop -- heartbeat loop intentionally emits over time.
					await emitObservation({ type: "heartbeat" });
					// eslint-disable-next-line no-await-in-loop -- heartbeat cadence is sequential by design.
					await new Promise((resolve) => setTimeout(resolve, 2));
				}
			},
		};
		const agent = makeAgent([source], runner, { stallTimeoutMs: 50 });
		await agent.tickOnce();
		await new Promise((resolve) => setTimeout(resolve, 20));
		const second = await agent.tickOnce();
		expect(second.snapshot.running.has(key)).toBe(true);
		await agent.shutdown();
		await agent.tickOnce();
	});

	test("tick result records why selected work was not started", async () => {
		const slow = "skip:slow";
		const other = "skip:other";
		const sources: WorkSource[] = [
			{
				id: "skip-a",
				selectWork: () => [{ workKey: slow }, { workKey: slow }],
			},
			{ id: "skip-b", selectWork: () => [{ workKey: other }] },
		];
		const runner: WorkRunner = { run: () => never() };
		const agent = makeAgent(sources, runner, {
			policy: { maxConcurrentRuns: 1 },
		});
		const first = await agent.tickOnce();
		expect(first.started).toHaveLength(1);
		expect(first.skipped).toContainEqual(
			expect.objectContaining({ workKey: slow, reason: "duplicate_in_tick" }),
		);
		expect(first.skipped).toContainEqual(
			expect.objectContaining({ reason: "capacity_exhausted" }),
		);
		const second = await agent.tickOnce();
		expect(second.skipped).toContainEqual(
			expect.objectContaining({ reason: "already_running" }),
		);
	});

	test("wakeAfter survives a concurrent tick and appears in the snapshot", async () => {
		const agent = makeAgent([makeWorkSource("waker", "wake:1")]);
		await agent.wakeAfter(60_000, "external");
		await agent.tickOnce();
		const snapshot = await agent.snapshot();
		expect(snapshot.scheduledWakes).toContainEqual(
			expect.objectContaining({ reason: "external", delayMs: 60_000 }),
		);
	});
});
