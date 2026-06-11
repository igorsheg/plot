import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "../src/agent-session-types.js";
import { sourceId, workKey } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { makePlotSessionLayer } from "../src/plot-session.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	runtime: {},
	prompt: "Do useful work.",
};

const iterable = async function* <A>(items: readonly A[]) {
	for (const item of items) yield item;
};

const fakeAgentClient = (events: readonly AgentSessionEvent[] = []) => ({
	prompt: () => iterable(events),
});

const collectN = async <A>(
	stream: AsyncIterable<A>,
	count: number,
	predicate: (item: A) => boolean = () => true,
): Promise<A[]> => {
	const items: A[] = [];
	for await (const item of stream) {
		if (!predicate(item)) continue;
		items.push(item);
		if (items.length >= count) break;
	}
	return items;
};

describe("PlotSession", () => {
	test("sequences lifecycle events for outer status surfaces", async () => {
		const runner: WorkRunner = {
			run: () => ({}),
		};
		const session = makePlotSessionLayer({ workflow, sources: [], runner });
		const collected = collectN(
			session.events(),
			2,
			(event) =>
				event.type === "session_started" || event.type === "session_shutdown",
		);

		await Promise.resolve();
		await session.start();
		await session.shutdown();
		const result = await collected;

		expect(result.map((event) => event.type)).toEqual([
			"session_started",
			"session_shutdown",
		]);
		expect(Number(result[0]?.sequence)).toBe(1);
		expect(Number(result[1]?.sequence)).toBeGreaterThan(1);
	});

	test("wraps plot agent events for outer status surfaces", async () => {
		const source: WorkSource = {
			id: sourceId("status-source"),
			selectWork: () => [{ workKey: workKey("status:1") }],
		};
		const runner: WorkRunner = {
			run: () => ({}),
		};
		const session = makePlotSessionLayer({
			workflow,
			sources: [source],
			runner,
		});
		const collected = collectN(session.events(), 3);

		await Promise.resolve();
		await session.tickOnce();
		const result = await collected;

		expect(result.map((event) => event.type)).toEqual([
			"plot_agent_event",
			"plot_agent_event",
			"plot_agent_event",
		]);
		expect(result.map((event) => Number(event.sequence))).toEqual([1, 2, 3]);
	});

	test("wraps raw agent session events with session and run provenance", async () => {
		const rawEvent: AgentSessionEvent = { type: "agent_start" };
		const source: WorkSource = {
			id: sourceId("agent-source"),
			selectWork: () => [{ workKey: workKey("agent:1") }],
		};

		const session = makePlotSessionLayer({
			workflow,
			sources: [source],
			agentRunner: { prompt: "do work" },
			client: fakeAgentClient([rawEvent]),
		});
		const collected = collectN(
			session.events(),
			1,
			(event) => event.type === "agent_session_event",
		);

		await Promise.resolve();
		await session.tickOnce();
		const [result] = await collected;
		expect(result).toBeDefined();

		expect(result).toEqual(
			expect.objectContaining({
				type: "agent_session_event",
				eventType: "agent_start",
				sourceId: sourceId("agent-source"),
				workKey: workKey("agent:1"),
			}),
		);
		if (result?.type !== "agent_session_event") throw new Error("wrong event");
		expect(result.event).toBe(rawEvent);
	});
});
