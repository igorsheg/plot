import { describe, expect, test } from "bun:test";
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
	sources: readonly WorkSource[],
	runner: WorkRunner = succeedRunner(),
	options: Omit<PlotAgentLayerOptions, "sources" | "runner"> = {},
) => makePlotAgentLayer({ ...options, sources, runner });

const makeWorkSource = (id: string, key: string): WorkSource => ({
	id: sourceId(id),
	selectWork: () => [{ workKey: workKey(key) }],
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
		const subject = subjectKey("work-1");
		const key = workKey("review:work-1:v1");
		const source: WorkSource = {
			id: sourceId("demo"),
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
		const key = workKey("slow:1");
		const source: WorkSource = {
			id: sourceId("slow-source"),
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
		const subject = subjectKey("agent:turn:1");
		const key = workKey("agent:turn:1");
		const source: WorkSource = {
			id: sourceId("agent-source"),
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
			id: sourceId("cadence-source"),
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
			id: sourceId("wake-source"),
			observeTick: () => {
				ticks += 1;
				if (ticks === 2) secondTick.resolve(ticks);
				return [];
			},
			reconcile: () => (ticks === 1 ? [scheduleWake(1, "retry later")] : []),
		};
		const agent = makeAgent([source]);
		await agent.start();
		await agent.offer({ type: "tick" });
		await yieldNow();
		expect((await agent.snapshot()).scheduledWakes?.[0]?.reason).toBe(
			"retry later",
		);
		const count = await secondTick.promise;
		await agent.shutdown();
		expect(count).toBe(2);
	});

	test("actor run consumes queued wake sources and owns the agent", async () => {
		const subject = subjectKey("actor:1");
		const source: WorkSource = {
			id: sourceId("actor-source"),
			observeTick: () => [{ type: "actor-seen", subject }],
			reconcile: ({ snapshot }) =>
				snapshot.observations.map((o) => setFact(`seen:${o.subject}`, true)),
		};
		const agent = makeAgent([source]);
		await agent.start();
		await agent.offer({ type: "tick" });
		await agent.shutdown();
		await yieldNow();
		const snapshot = await agent.snapshot();
		expect(snapshot.facts.get("seen:actor:1")).toBe(true);
	});

	test("sources select work while the runner owns inner agent execution", async () => {
		const ready = { provider: "plot-faux", model: "faux-1" };
		const pr = subjectKey("github:acme/web:pr:42");
		const key = workKey("review:github:acme/web:pr:42:sha-1");
		const calls: unknown[] = [];
		const source: WorkSource = {
			id: sourceId("github"),
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
		const slow = workKey("aaa-slow");
		const fast = workKey("fast");
		const sourceA: WorkSource = {
			id: sourceId("a"),
			policy: { maxConcurrentRuns: 1 },
			selectWork: () => [{ workKey: slow }, { workKey: workKey("blocked") }],
		};
		const sourceB: WorkSource = {
			id: sourceId("b"),
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
			makeAgent([
				{ id: sourceId("bad-source"), policy: { maxConcurrentRuns: 0 } },
			]);
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(PlotAgentError);
		expect((error as PlotAgentError).phase).toBe("setup");
		expect((error as Error).message).toContain("maxConcurrentRuns");
	});

	test("completion does not make work terminal; sources own rerun semantics", async () => {
		const key = workKey("rerun:1");
		const source: WorkSource = {
			id: sourceId("rerun"),
			selectWork: () => [{ workKey: key }],
		};
		const agent = makeAgent([source]);
		await agent.tickOnce();
		await yieldNow();
		const second = await agent.tickOnce();
		await yieldNow();
		const third = await agent.tickOnce();
		expect(second.completions).toHaveLength(1);
		expect(third.started).toHaveLength(1);
	});

	test("sources can interrupt running work without owning runner fibers", async () => {
		const key = workKey("interrupt:1");
		const started = deferred<void>();
		const interrupted = deferred<void>();
		let shouldInterrupt = false;
		const source: WorkSource = {
			id: sourceId("interrupt-source"),
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

	test("runtime snapshot keeps bounded diagnostics history", async () => {
		const source: WorkSource = {
			id: sourceId("diagnostic-source"),
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
		const key = workKey("timeout:1");
		const started = deferred<void>();
		const source: WorkSource = {
			id: sourceId("timeout-source"),
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
				if (event.type === "work_completed") return event.completion;
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
		const key = workKey("status:1");
		const source: WorkSource = {
			id: sourceId("status-source"),
			selectWork: () => [{ workKey: key }],
		};
		const agent = makeAgent([source]);
		const pending = collectN(agent.events(), 3);
		await Promise.resolve();
		await agent.tickOnce();
		const events = await pending;
		expect(events.map((event) => event.type)).toEqual([
			"tick_started",
			"work_started",
			"tick_completed",
		]);
	});

	test("shutdown interrupts active runner work and clears running claims", async () => {
		const key = workKey("shutdown:1");
		const started = deferred<void>();
		const interrupted = deferred<void>();
		const source: WorkSource = {
			id: sourceId("shutdown-source"),
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
		const key = workKey("fail:1");
		const source: WorkSource = {
			id: sourceId("fail-source"),
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
});
