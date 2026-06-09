import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { sourceId, tickId, workKey, runId } from "@plot/core/domain";
import { AgentSessionClient } from "../src/client.js";
import { makeAgentSessionWorkRunner } from "../src/runner.js";

const context = {
	sourceId: sourceId("agent-source"),
	tickId: tickId(1),
	run: {
		runId: runId("run-1"),
		sourceId: sourceId("agent-source"),
		workKey: workKey("agent:1"),
	},
	work: { workKey: workKey("agent:1") },
	snapshot: {
		tickId: tickId(1),
		facts: new Map(),
		observations: [],
		completions: [],
		diagnostics: [],
		running: new Map(),
	},
	emitObservation: () => Effect.succeed(true),
};

describe("agent session work runner", () => {
	test("keeps agent execution non-fatal when onEvent fails", async () => {
		const layer = Layer.succeed(AgentSessionClient, {
			prompt: () => Stream.make({ type: "agent_start" } as AgentSessionEvent),
		});

		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const runner = yield* makeAgentSessionWorkRunner({
					prompt: "do work",
					onEvent: () => Effect.fail("listener failed"),
				});
				return yield* runner.run(context);
			}).pipe(Effect.provide(layer)),
		);

		expect(result).toEqual({});
	});

	test("forwards raw AgentSessionEvent values without wrapping", async () => {
		const events: AgentSessionEvent[] = [
			{ type: "agent_start" },
			{ type: "agent_end", messages: [], willRetry: false },
		];
		const seen: AgentSessionEvent[] = [];
		const prompts: string[] = [];
		const layer = Layer.succeed(AgentSessionClient, {
			prompt: (request) => {
				prompts.push(request.prompt);
				return Stream.fromIterable(events);
			},
		});

		await Effect.runPromise(
			Effect.gen(function* () {
				const runner = yield* makeAgentSessionWorkRunner({
					prompt: "do work",
					onEvent: (event) =>
						Effect.sync(() => {
							seen.push(event);
						}),
				});
				return yield* runner.run(context);
			}).pipe(Effect.provide(layer)),
		);

		expect(prompts).toEqual(["do work"]);
		expect(seen).toEqual(events);
		expect(seen[0]).toBe(events[0]);
		expect(seen[1]).toBe(events[1]);
	});
});
