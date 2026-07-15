import { describe, expect, test } from "bun:test";
import { makePlotAgent } from "../src/agent.js";
import type {
	Completion,
	PlotAgentEvent,
	SourceRecord,
	SourceWorkRecord,
	WorkItem,
	WorkResult,
} from "../src/model.js";
import type { WorkRunner } from "../src/work-runner.js";
import type { WorkSource } from "../src/work-source.js";

const ready: SourceRecord = {
	sourceId: "source",
	label: "Source",
	readiness: "ready",
	requirements: [],
};

const item = (key: string): WorkItem => ({
	workKey: key,
	subject: key,
});

const record = (key: string): SourceWorkRecord => ({
	workKey: key,
	sourceId: "source",
	status: "pending",
	subject: key,
});

const deferred = <A>() => {
	let resolve!: (value: A) => void;
	const promise = new Promise<A>((yes) => (resolve = yes));
	return { promise, resolve };
};

const waitFor = async (condition: () => boolean, timeoutMs = 500) => {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition timed out");
		await Bun.sleep(2);
	}
};

const source = (input: {
	work: () => readonly WorkItem[];
	cancel?: () => readonly { workKey: string; reason: string }[];
	log?: string[];
	finished?: (completion: Completion) => void;
}): WorkSource => ({
	initial: ready,
	maxConcurrentRuns: 2,
	reconcile: () => {
		input.log?.push("reconcile");
		const work = input.work();
		return {
			source: ready,
			work: work.map((candidate) => record(candidate.workKey)),
			dispatch: work,
			cancel: input.cancel?.() ?? [],
			wakes: [],
		};
	},
	started: () => {
		input.log?.push("started");
	},
	finished: ({ completion }) => {
		input.log?.push(`finished:${completion.status}`);
		input.finished?.(completion);
	},
	continueWork: ({ run }) =>
		input.work().some((candidate) => candidate.workKey === run.workKey),
});

const agentFor = (input: {
	source: WorkSource;
	runner: WorkRunner;
	events?: PlotAgentEvent[];
	maxRunDurationMs?: number;
	stallTimeoutMs?: number;
}) => {
	return makePlotAgent({
		source: input.source,
		runner: input.runner,
		event: (event) => {
			input.events?.push(event);
		},
		tickIntervalMs: 60_000,
		maxRunDurationMs: input.maxRunDurationMs,
		stallTimeoutMs: input.stallTimeoutMs,
	});
};

describe("Plot Agent owner", () => {
	test("reconciles, records, then launches without awaiting the run", async () => {
		const log: string[] = [];
		const blocked = deferred<WorkResult>();
		const agent = agentFor({
			source: source({ work: () => [item("one")], log }),
			runner: {
				run: () => {
					log.push("run");
					return blocked.promise;
				},
			},
		});
		await agent.start();
		const tick = await agent.tickOnce();
		expect(tick.started).toBe(1);
		expect(log.slice(0, 3)).toEqual(["reconcile", "started", "run"]);
		await agent.shutdown();
	});

	test("admits one completion and ignores the stale duplicate", async () => {
		let work: readonly WorkItem[] = [item("one")];
		const run = deferred<WorkResult>();
		const events: PlotAgentEvent[] = [];
		const finished: Completion[] = [];
		const agent = agentFor({
			source: source({
				work: () => work,
				finished: (completion) => {
					finished.push(completion);
					work = [];
				},
			}),
			runner: { run: () => run.promise },
			events,
		});
		await agent.start();
		await agent.tickOnce();
		run.resolve({ output: "done" });
		await waitFor(() =>
			events.some((event) => event.type === "attempt_completed"),
		);
		await agent.tickOnce();
		expect(finished).toHaveLength(1);
		expect(finished[0]?.status).toBe("succeeded");
		await agent.shutdown();
	});

	test("missing work drains its active run and stops continuation", async () => {
		let work: readonly WorkItem[] = [item("one")];
		let continueRun: ((turn: number) => boolean | Promise<boolean>) | undefined;
		const events: PlotAgentEvent[] = [];
		const agent = agentFor({
			source: source({ work: () => work }),
			runner: {
				run: async (context) => {
					continueRun = context.shouldContinue;
					return await new Promise<WorkResult>(() => {});
				},
			},
			events,
		});
		await agent.start();
		await agent.tickOnce();
		work = [];
		await agent.tickOnce();
		expect(await continueRun?.(1)).toBe(false);
		expect(
			events.some(
				(event) =>
					event.type === "work_observed" && event.work.status === "draining",
			),
		).toBe(true);
		await agent.shutdown();
	});

	test("Source cancellation interrupts the matching run exactly once", async () => {
		let cancel = false;
		const completions: Completion[] = [];
		const agent = agentFor({
			source: source({
				work: () => [item("one")],
				cancel: () => (cancel ? [{ workKey: "one", reason: "cancelled" }] : []),
				finished: (completion) => completions.push(completion),
			}),
			runner: { run: async () => await new Promise<WorkResult>(() => {}) },
		});
		await agent.start();
		await agent.tickOnce();
		cancel = true;
		await agent.tickOnce();
		await agent.tickOnce();
		expect(completions).toHaveLength(1);
		expect(completions[0]).toMatchObject({
			status: "interrupted",
			reason: "cancelled",
		});
		await agent.shutdown();
	});

	test("bounds externally admitted Operator Observations", async () => {
		const agent = agentFor({
			source: source({ work: () => [] }),
			runner: { run: async () => ({}) },
		});
		await agent.start();
		const admitted = Array.from({ length: 65 }, (_, index) =>
			agent.offerOperatorObservation({
				sourceId: "source",
				workKey: `work-${index}`,
				actionId: "act",
				actionLabel: "Act",
				timestamp: "2026-01-01T00:00:00.000Z",
			}),
		);
		expect(admitted.filter(Boolean)).toHaveLength(64);
		expect(admitted.at(-1)).toBe(false);
		await agent.shutdown();
	});

	test("ignores a stale runner completion after duration timeout", async () => {
		const completions: Completion[] = [];
		const runner = deferred<WorkResult>();
		let work: readonly WorkItem[] = [item("one")];
		const agent = agentFor({
			source: source({
				work: () => work,
				finished: (completion) => {
					completions.push(completion);
					work = [];
				},
			}),
			runner: { run: () => runner.promise },
			maxRunDurationMs: 10,
		});
		await agent.start();
		await agent.tickOnce();
		await waitFor(() => completions.length === 1);
		runner.resolve({ output: "late" });
		await Bun.sleep(5);
		await agent.tickOnce();
		expect(completions).toHaveLength(1);
		expect(completions[0]?.status).toBe("timed_out");
		await agent.shutdown();
	});

	test("enforces the one Source concurrency bound", async () => {
		const selected = [item("one"), item("two"), item("three")];
		const limited = source({ work: () => selected });
		(limited as { maxConcurrentRuns: number }).maxConcurrentRuns = 2;
		const agent = agentFor({
			source: limited,
			runner: { run: async () => await new Promise<WorkResult>(() => {}) },
		});
		await agent.start();
		const tick = await agent.tickOnce();
		expect(tick.started).toBe(2);
		await agent.shutdown();
	});

	test("forbids restart after shutdown begins", async () => {
		const agent = agentFor({
			source: source({ work: () => [] }),
			runner: { run: async () => ({}) },
		});
		await agent.start();
		await agent.shutdown();
		await expect(agent.start()).rejects.toThrow(
			"cannot start Agent while stopped",
		);
	});
});
