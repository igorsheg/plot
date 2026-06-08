import { describe, expect, test } from "bun:test";
import { Cause, Effect, Stream } from "effect";
import type {
	AgentSession,
	AgentSessionEvent,
	AgentSessionEventListener,
	CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import { AgentSessionClient, makePiMonoAgentSessionLayer, PiMonoAgentSessionError } from "../src/llm/index.js";

const fakeResult = (session: AgentSession) =>
	({ session, extensionsResult: {} }) as unknown as CreateAgentSessionResult;

function makeFakeSession(options?: { readonly promptError?: Error }) {
	let listener: AgentSessionEventListener | undefined;
	let disposed = false;
	let unsubscribed = false;
	const events: AgentSessionEvent[] = [
		{ type: "agent_start" },
		{ type: "agent_end", messages: [], willRetry: false },
	];

	const session = {
		subscribe: (next: AgentSessionEventListener) => {
			listener = next;
			return () => {
				unsubscribed = true;
			};
		},
		prompt: async () => {
			if (options?.promptError) throw options.promptError;
			for (const event of events) listener?.(event);
		},
		dispose: () => {
			disposed = true;
		},
	} as unknown as AgentSession;

	return {
		session,
		state: () => ({ disposed, unsubscribed }),
	};
}

describe("llm pi-mono adapter", () => {
	test("streams pi-mono AgentSessionEvent values without translating their taxonomy", async () => {
		const fake = makeFakeSession();
		const layer = makePiMonoAgentSessionLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const program = Effect.gen(function* () {
			const client = yield* AgentSessionClient;
			return yield* client.prompt({ prompt: "hello" }).pipe(Stream.runCollect);
		}).pipe(Effect.provide(layer));

		const events = await Effect.runPromise(program);
		expect(events.map((event) => event.type)).toEqual(["agent_start", "agent_end"]);
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});

	test("fails the stream with a typed adapter error when prompting fails", async () => {
		const fake = makeFakeSession({ promptError: new Error("no model") });
		const layer = makePiMonoAgentSessionLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const program = Effect.gen(function* () {
			const client = yield* AgentSessionClient;
			return yield* client.prompt({ prompt: "hello" }).pipe(Stream.runCollect, Effect.exit);
		}).pipe(Effect.provide(layer));

		const exit = await Effect.runPromise(program);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure") {
			const error = Cause.squash(exit.cause);
			expect(error).toBeInstanceOf(PiMonoAgentSessionError);
			expect((error as PiMonoAgentSessionError).phase).toBe("prompt");
		}
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});
});
