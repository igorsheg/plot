import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { createFileEventLogStore } from "../src/event-log.js";
import { makeAgentSessionRuntime } from "../src/agent-runtime.js";

const tempSessionDir = () => mkdtemp(join(tmpdir(), "plot-runtime-"));

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
	id: sourceId("runtime-test"),
	selectWork: () => [{ workKey: workKey("work-1") }],
};

const runner: WorkRunner = {
	run: () => ({ output: "ok" }),
};

test("runtime projects agent events into the event log", async () => {
	const eventLog = await createFileEventLogStore({
		sessionDir: await tempSessionDir(),
		sessionId: "session-1",
	});
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
		eventLog,
		sources: [source],
		runner,
	});

	const events = runtime.events();
	await runtime.tickOnce();

	const tickCompleted = await waitForEvent(
		events,
		(record) =>
			record.kind === "session_event" && record.type === "tick_completed",
	);
	expect(tickCompleted).toMatchObject({
		kind: "session_event",
		type: "tick_completed",
	});
	const persisted = (await eventLog.readAll()).records;
	expect(persisted.map((record) => record.sequence)).toEqual(
		persisted.map((_, index) => index + 1),
	);
	expect(
		persisted.some(
			(record) =>
				record.kind === "session_event" && record.type === "tick_completed",
		),
	).toBe(true);

	await runtime.shutdown();
});

test("runtime publishes appended inner agent events", async () => {
	const eventLog = await createFileEventLogStore({
		sessionDir: await tempSessionDir(),
		sessionId: "session-1",
	});
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
		eventLog,
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

test("runtime shutdown appends shutdown after agent event pump drains", async () => {
	const eventLog = await createFileEventLogStore({
		sessionDir: await tempSessionDir(),
		sessionId: "session-1",
	});
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
		eventLog,
		sources: [],
		runner,
	});

	await runtime.start();
	await runtime.shutdown();
	const records = (await eventLog.readAll()).records;
	expect(records.at(-1)).toMatchObject({
		kind: "session_event",
		type: "session_shutdown",
	});
	expect(await runtime.shutdown()).toBe(true);
});
