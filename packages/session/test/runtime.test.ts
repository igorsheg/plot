import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { readSessionEvents } from "../src/history.js";
import { makeSessionRuntime } from "../src/runtime.js";

const deferred = <A>() => {
	let resolve!: (value: A) => void;
	const promise = new Promise<A>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

const waitForEvent = async <A>(
	iterable: AsyncIterable<A>,
	predicate: (item: A) => boolean,
): Promise<A> => {
	const iterator = iterable[Symbol.asyncIterator]();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		const found = (async () => {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop -- helper polls until the requested event arrives.
				const next = await iterator.next();
				if (next.done) break;
				if (predicate(next.value)) return next.value;
			}
			throw new Error("event stream ended before matching event");
		})();
		const timedOut = new Promise<never>((_, reject) => {
			timeout = setTimeout(() => reject(new Error("timed out")), 1000);
		});
		return await Promise.race([found, timedOut]);
	} finally {
		if (timeout) clearTimeout(timeout);
		await iterator.return?.();
	}
};

const source: WorkSource = {
	id: "runtime-test",
	selectWork: () => [{ workKey: "work-1" }],
};

const runner: WorkRunner = {
	run: () => ({ output: "ok" }),
};

test("runtime projects agent events into the live stream", async () => {
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [source],
		runner,
	});

	const events = runtime.events();
	await runtime.tickOnce();

	const tickCompleted = await waitForEvent(
		events,
		(record) =>
			record.kind === "session_event" && record.event.type === "tick_completed",
	);
	expect(tickCompleted).toMatchObject({
		kind: "session_event",
		event: { type: "tick_completed" },
	});
	expect(await runtime.lastEventSequence()).toBe(tickCompleted.sequence);

	await runtime.shutdown();
});

test("runtime emits typed attempt completion events", async () => {
	let release!: () => void;
	const done = new Promise<void>((resolve) => {
		release = resolve;
	});
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [source],
		runner: { run: async () => ({ output: await done }) },
	});

	const events = runtime.events();
	await runtime.tickOnce();
	release();
	await new Promise((resolve) => setTimeout(resolve, 0));
	await runtime.tickOnce();

	const completed = await waitForEvent(
		events,
		(record) =>
			record.kind === "session_event" &&
			record.event.type === "attempt_completed" &&
			record.event.completion.workKey === "work-1",
	);
	expect(completed.kind).toBe("session_event");
	if (completed.kind === "session_event") {
		expect(completed.event.type).toBe("attempt_completed");
		if (completed.event.type === "attempt_completed")
			expect(completed.event.completion.workKey).toBe("work-1");
	}

	await runtime.shutdown();
});

test("runtime publishes appended inner agent events", async () => {
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [],
		runner,
	});

	const events = runtime.events();
	await runtime.appendAgentEvent({
		sourceId: "runtime-test",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "message_update" },
	});

	const agentEvent = await waitForEvent(
		events,
		(record) => record.kind === "agent_event",
	);
	expect(agentEvent).toMatchObject({
		kind: "agent_event",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "message_update" },
	});

	await runtime.shutdown();
});

test("runtime writes durable session events before closing", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-session-history-"));
	const sessionFile = join(dir, "session-1.jsonl");
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [],
		runner,
		sessionFile,
	});

	await runtime.start();
	await runtime.appendAgentEvent({
		sourceId: "runtime-test",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "message_delta", delta: "live only" },
	});
	await runtime.appendAgentEvent({
		sourceId: "runtime-test",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "message_end" },
	});
	await runtime.shutdown();

	const events = [];
	for await (const event of readSessionEvents(sessionFile)) events.push(event);
	expect(new Set(events.map((event) => event.sequence)).size).toBe(
		events.length,
	);
	expect(events.map((event) => event.sequence)).not.toContain(2);
	expect(
		events.some(
			(event) =>
				event.kind === "agent_event" &&
				JSON.stringify(event.event).includes("message_delta"),
		),
	).toBe(false);
	expect(events).toContainEqual(
		expect.objectContaining({
			kind: "agent_event",
			sequence: 3,
			event: { type: "message_end" },
		}),
	);
});

test("tickOnce waits until its durable events establish the sequence fence", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-session-fence-"));
	const runtime = makeSessionRuntime({
		id: "session-fence",
		sources: [],
		runner,
		sessionFile: join(dir, "session-fence.jsonl"),
	});

	await runtime.tickOnce();

	expect(await runtime.lastEventSequence()).toBe(2);
	await runtime.shutdown();
});

test("runtime publishes session start once", async () => {
	const runtime = makeSessionRuntime({
		id: "session-lifecycle",
		sources: [],
		runner,
	});
	const seen: string[] = [];
	const collector = (async () => {
		for await (const record of runtime.events())
			if (record.kind === "session_event") seen.push(record.event.type);
	})();

	await runtime.start();
	await runtime.start();
	await runtime.shutdown();
	await collector;

	expect(seen.filter((type) => type === "session_started")).toHaveLength(1);
	await expect(runtime.start()).rejects.toThrow("closed");
	await expect(
		runtime.appendAgentEvent({
			sourceId: "source",
			runId: "run",
			workKey: "work",
			event: {},
		}),
	).rejects.toThrow("closed");
});

test("runtime shutdown publishes shutdown and is idempotent", async () => {
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [],
		runner,
	});

	const events = runtime.events();
	await runtime.start();
	const shutdown = waitForEvent(
		events,
		(record) =>
			record.kind === "session_event" &&
			record.event.type === "session_shutdown",
	);
	expect(await runtime.shutdown()).toBe(true);
	expect(await shutdown).toMatchObject({
		kind: "session_event",
		event: { type: "session_shutdown" },
	});
	expect(await runtime.shutdown()).toBe(true);
});

test("Source setup actions publish progress and can be cancelled", async () => {
	const started = deferred<void>();
	const runtime = makeSessionRuntime({
		id: "session-source-action",
		sources: [],
		runner,
		sourceAction: {
			sourceId: "extension:jira",
			runAction: async ({ interaction, signal }) => {
				await interaction.reportProgress("Waiting for authorization");
				await interaction.openUrl("https://example.com/oauth");
				started.resolve();
				await new Promise<void>((resolve) =>
					signal.addEventListener("abort", () => resolve(), { once: true }),
				);
				throw new Error("cancelled");
			},
		},
	});
	const events: string[] = [];
	const collector = (async () => {
		for await (const record of runtime.events())
			if (record.kind === "session_event") events.push(record.event.type);
	})();

	const action = await runtime.startSourceAction({
		sourceId: "extension:jira",
		requirementId: "wix-mcp",
		actionId: "connect",
	});
	await started.promise;
	expect(action.accepted).toBe(true);
	if (action.actionRunId === undefined)
		throw new Error("missing Source action identifier");
	expect(await runtime.cancelSourceAction(action.actionRunId)).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await runtime.shutdown();
	await collector;

	expect(events).toContain("source_action_started");
	expect(events).toContain("source_action_progress");
	expect(events).toContain("source_interaction_open_url");
	expect(events).toContain("source_action_cancelled");
});

test("operator observations reach sources on the next tick", async () => {
	let seen: { readonly type: string; readonly data?: unknown } | undefined;
	const observingSource: WorkSource = {
		id: "obs-test",
		reconcile: ({ snapshot }) => {
			seen ??= snapshot.observations.find(
				(observation) => observation.type === "operator_observation",
			);
			return [];
		},
	};
	const runtime = makeSessionRuntime({
		id: "session-1",
		sources: [observingSource],
		runner,
	});

	const accepted = await runtime.recordOperatorObservation({
		sourceId: "obs-test",
		workKey: "work-1",
		actionId: "approve",
		actionLabel: "Approve",
		actor: "web",
	});
	expect(accepted).toBe(true);
	await runtime.tickOnce();
	await runtime.shutdown();

	const data = seen?.data as Record<string, unknown>;
	expect(data["actionId"]).toBe("approve");
	expect(data["actor"]).toBe("web");
	expect(typeof data["timestamp"]).toBe("string");
});
