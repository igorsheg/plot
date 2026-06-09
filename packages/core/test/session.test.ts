import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, Stream } from "effect";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { sourceId, workKey } from "../src/domain.js";
import { AgentSessionClient } from "../src/llm.js";
import { PlotSession, makePlotSessionLayer } from "../src/session.js";
import type { WorkRunner } from "../src/runner.js";
import type { WorkSource } from "../src/source.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	prompt: "Do useful work.",
};

const fakeAgentLayer = (events: readonly AgentSessionEvent[] = []) =>
	Layer.succeed(AgentSessionClient, {
		prompt: () => Stream.fromIterable(events),
	});

describe("PlotSession", () => {
	test("sequences lifecycle events for outer status surfaces", async () => {
		const runner: WorkRunner = {
			run: () => Effect.succeed({}),
		};

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* PlotSession;
					const fiber = yield* session
						.events()
						.pipe(Stream.take(2), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* session.start();
					yield* session.shutdown();
					return yield* Fiber.join(fiber);
				}),
			).pipe(
				Effect.provide(makePlotSessionLayer({ workflow, sources: [], runner })),
			),
		);

		expect(result.map((event) => event.type)).toEqual([
			"session_started",
			"session_shutdown",
		]);
		expect(result.map((event) => Number(event.sequence))).toEqual([1, 2]);
	});

	test("wraps orchestrator events for outer status surfaces", async () => {
		const source: WorkSource = {
			id: sourceId("status-source"),
			selectWork: () => Effect.succeed([{ workKey: workKey("status:1") }]),
		};
		const runner: WorkRunner = {
			run: () => Effect.succeed({}),
		};

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* PlotSession;
					const fiber = yield* session
						.events()
						.pipe(Stream.take(3), Stream.runCollect, Effect.forkScoped);
					yield* Effect.yieldNow;
					yield* session.tickOnce();
					const events = yield* Fiber.join(fiber);
					return events;
				}),
			).pipe(
				Effect.provide(
					makePlotSessionLayer({ workflow, sources: [source], runner }),
				),
			),
		);

		expect(result.map((event) => event.type)).toEqual([
			"orchestrator_event",
			"orchestrator_event",
			"orchestrator_event",
		]);
		expect(
			result.map((event) =>
				"sequence" in event ? Number(event.sequence) : undefined,
			),
		).toEqual([1, 2, 3]);
	});

	test("wraps raw agent session events with session and run provenance", async () => {
		const rawEvent: AgentSessionEvent = { type: "agent_start" };
		const source: WorkSource = {
			id: sourceId("agent-source"),
			selectWork: () => Effect.succeed([{ workKey: workKey("agent:1") }]),
		};

		const layer = makePlotSessionLayer({
			workflow,
			sources: [source],
			agentRunner: { prompt: "do work" },
		}).pipe(Layer.provide(fakeAgentLayer([rawEvent])));
		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.gen(function* () {
					const session = yield* PlotSession;
					const fiber = yield* session.events().pipe(
						Stream.filter((event) => event.type === "agent_event"),
						Stream.take(1),
						Stream.runCollect,
						Effect.forkScoped,
					);
					yield* Effect.yieldNow;
					yield* session.tickOnce();
					const events = yield* Fiber.join(fiber);
					const event = events[0];
					expect(event).toBeDefined();
					return event!;
				}),
			).pipe(Effect.provide(layer)),
		);

		expect(result).toEqual(
			expect.objectContaining({
				type: "agent_event",
				eventType: "agent_start",
				sourceId: sourceId("agent-source"),
				workKey: workKey("agent:1"),
			}),
		);
		expect(result.event).toBe(rawEvent);
	});
});
