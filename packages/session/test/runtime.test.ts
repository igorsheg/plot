import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SourceRecord } from "@plot/agent/model";
import type { WorkSource } from "@plot/agent/work-source";
import {
	decodeRuntimeEvent,
	makeSessionEventOwner,
	makeSessionRuntime,
	type SessionSource,
	type SourceActionStartResult,
} from "../src/runtime.js";
import { readSessionEvents } from "../src/history.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

const ready: SourceRecord = {
	sourceId: "source",
	label: "Source",
	readiness: "ready",
	requirements: [],
};

const workSource = (): WorkSource => ({
	initial: ready,
	maxConcurrentRuns: 1,
	reconcile: () => ({
		source: ready,
		work: [],
		dispatch: [],
		cancel: [],
		wakes: [],
	}),
	started: () => {},
	finished: () => {},
	continueWork: () => false,
});

const harness = async (overrides: Partial<SessionSource> = {}) => {
	const root = await mkdtemp(join(tmpdir(), "plot-runtime-"));
	roots.push(root);
	const events = makeSessionEventOwner({
		id: "session-1",
		sessionFile: join(root, "events.jsonl"),
	});
	const source: SessionSource = {
		source: workSource(),
		startAction: async () => ({ accepted: false }),
		cancelAction: () => false,
		shutdown: async () => {},
		...overrides,
	};
	const runtime = makeSessionRuntime({
		events,
		source,
		runner: { run: async () => ({}) },
		tickIntervalMs: 60_000,
	});
	return { root, events, source, runtime };
};

const collect = async <A>(iterable: AsyncIterable<A>, count: number) => {
	const values: A[] = [];
	for await (const value of iterable) {
		values.push(value);
		if (values.length === count) break;
	}
	return values;
};

describe("Session runtime ownership", () => {
	test("durably appends before publishing and allocates one sequence", async () => {
		const { events } = await harness();
		const controller = new AbortController();
		const live = collect(events.events(controller.signal), 1);
		const appended = await events.appendAgentEvent({
			sourceId: "source",
			runId: "run-1",
			workKey: "work-1",
			event: { type: "message_update" },
		});
		expect((await live)[0]).toEqual(appended);
		const history = [];
		for await (const event of readSessionEvents(events.sessionFile))
			history.push(event);
		expect(history).toEqual([appended]);
		controller.abort();
		await events.close();
	});

	test("start and tick resolve after their Session events are durable", async () => {
		const { events, runtime } = await harness();
		await runtime.start();
		const summary = await runtime.tickOnce();
		expect(summary.tickId).toBeGreaterThan(0);
		const history = [];
		for await (const event of readSessionEvents(events.sessionFile))
			history.push(event);
		expect(
			history.some(
				(record) =>
					record.kind === "session_event" &&
					record.event.type === "tick_completed",
			),
		).toBe(true);
		await runtime.shutdown();
	});

	test("delegates Source action admission with an exact accepted union", async () => {
		let actionEvents:
			| Parameters<SessionSource["startAction"]>[0]["events"]
			| undefined;
		const accepted: SourceActionStartResult = {
			accepted: true,
			actionRunId: "action-1",
		};
		const { runtime } = await harness({
			startAction: async (input) => {
				actionEvents = input.events;
				await input.events.started("action-1");
				return accepted;
			},
		});
		await runtime.start();
		const result = await runtime.startSourceAction({
			sourceId: "source",
			requirementId: "auth",
			actionId: "connect",
		});
		expect(result).toEqual(accepted);
		await actionEvents?.progress("action-1", "working");
		await actionEvents?.completed("action-1", ready);
		await runtime.shutdown();
	});

	test("rejects controls outside running state", async () => {
		const { runtime } = await harness();
		await expect(runtime.tickOnce()).rejects.toThrow("Session is new");
		await runtime.shutdown();
		await expect(runtime.start()).rejects.toThrow(
			"cannot start Session while closed",
		);
	});

	test("shutdown stops Agent before closing the Source and event owner", async () => {
		const order: string[] = [];
		const { events, runtime } = await harness({
			shutdown: async () => {
				order.push("source");
			},
		});
		await runtime.start();
		await runtime.shutdown();
		order.push("closed");
		expect(order).toEqual(["source", "closed"]);
		await expect(
			events.appendSessionEvent({ type: "session_started" }),
		).rejects.toThrow("closed");
	});

	test("decodes RuntimeEvent envelopes at process boundaries", () => {
		expect(
			decodeRuntimeEvent({
				kind: "agent_event",
				sessionId: "session-1",
				sequence: 1,
				timestamp: new Date().toISOString(),
				sourceId: "source",
				runId: "run",
				workKey: "work",
				event: {},
			}),
		).toMatchObject({ kind: "agent_event", sequence: 1 });
		expect(() => decodeRuntimeEvent({ kind: "agent_event" })).toThrow();
	});
});
