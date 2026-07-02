import { expect, test } from "bun:test";
import { sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makeAgentSessionRuntime } from "../src/agent-runtime.js";

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

test("runtime projects agent events into the live stream", async () => {
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
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
	expect(await runtime.lastEventSequence()).toBe(tickCompleted.sequence);

	await runtime.shutdown();
});

test("runtime publishes appended inner agent events", async () => {
	const runtime = makeAgentSessionRuntime({
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

test("runtime publishes compact inner agent events", async () => {
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
		sources: [],
		runner,
	});

	const events = runtime.events();
	await runtime.appendAgentEvent({
		sourceId: "runtime-test",
		runId: "run-1",
		workKey: "work-1",
		event: {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 1,
				delta: "big body",
				partial: {
					content: [
						{
							type: "thinking",
							thinking: "reasoning",
							thinkingSignature: "encrypted-large-payload",
						},
						{
							type: "toolCall",
							id: "tool-1",
							name: "upsert_review_anchor",
							arguments: { body: "large review body", path: "kept.md" },
						},
					],
				},
			},
		},
	});

	const record = await waitForEvent(
		events,
		(entry) => entry.kind === "agent_event",
	);
	const encoded = JSON.stringify(record);
	expect(encoded).not.toContain("encrypted-large-payload");
	expect(encoded).not.toContain("large review body");
	expect(record).toMatchObject({
		kind: "agent_event",
		event: {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_delta",
				partial: {
					content: [
						{ type: "thinking", thinking: "reasoning" },
						{
							type: "toolCall",
							id: "tool-1",
							name: "upsert_review_anchor",
							arguments: { path: "kept.md" },
						},
					],
				},
			},
		},
	});

	await runtime.shutdown();
});

test("runtime shutdown publishes shutdown and is idempotent", async () => {
	const runtime = makeAgentSessionRuntime({
		id: "session-1",
		sources: [],
		runner,
	});

	const events = runtime.events();
	await runtime.start();
	const shutdown = waitForEvent(
		events,
		(record) =>
			record.kind === "session_event" && record.type === "session_shutdown",
	);
	expect(await runtime.shutdown()).toBe(true);
	expect(await shutdown).toMatchObject({
		kind: "session_event",
		type: "session_shutdown",
	});
	expect(await runtime.shutdown()).toBe(true);
});

test("operator observations reach sources on the next tick", async () => {
	let seen: { readonly type: string; readonly data?: unknown } | undefined;
	const observingSource: WorkSource = {
		id: sourceId("obs-test"),
		reconcile: ({ snapshot }) => {
			seen ??= snapshot.observations.find(
				(observation) => observation.type === "operator_observation",
			);
			return [];
		},
	};
	const runtime = makeAgentSessionRuntime({
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
