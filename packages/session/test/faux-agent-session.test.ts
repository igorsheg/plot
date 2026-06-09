import { describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import {
	AgentSessionClient,
	makeAgentSessionClientLayer,
} from "../src/agent-session-client.js";
import {
	createFauxAgentSessionHarness,
	fauxAssistantMessage,
} from "../src/testing/faux-agent-session.js";

describe("faux agent-session harness", () => {
	test("runs pi agent-session against deterministic faux provider", async () => {
		const harness = createFauxAgentSessionHarness({
			responses: [fauxAssistantMessage("hello from faux")],
		});
		const events = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* AgentSessionClient;
				const collected: unknown[] = [];
				yield* client
					.prompt({ prompt: "Say hello." })
					.pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => collected.push(event)),
						),
					);
				return collected;
			}).pipe(
				Effect.provide(
					makeAgentSessionClientLayer({
						createAgentSession: harness.createAgentSession,
					}),
				),
				Effect.ensuring(Effect.sync(() => harness.cleanup())),
			),
		);

		expect(
			events.some(
				(event) =>
					event !== null &&
					typeof event === "object" &&
					"type" in event &&
					event.type === "agent_end",
			),
		).toBe(true);
		expect(JSON.stringify(events)).toContain("hello from faux");
		expect(harness.getPendingResponseCount()).toBe(0);
	});
});
