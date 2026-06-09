import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Stream } from "effect";
import type {
	AgentSession,
	AgentSessionEvent,
	AgentSessionEventListener,
	CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import {
	AgentSessionClient,
	AgentSessionClientError,
	makeAgentSessionClientLayer,
} from "../src/client.js";

const fakeResult = (session: AgentSession) =>
	({ session, extensionsResult: {} }) as unknown as CreateAgentSessionResult;

function makeFakeSession(options?: {
	readonly promptError?: Error;
	readonly events?: readonly AgentSessionEvent[];
}) {
	let listener: AgentSessionEventListener | undefined;
	let disposed = false;
	let unsubscribed = false;
	const events: readonly AgentSessionEvent[] = options?.events ?? [
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

describe("agent session client", () => {
	test("streams raw AgentSessionEvent values without translating their taxonomy", async () => {
		const fake = makeFakeSession();
		const layer = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const program = Effect.gen(function* () {
			const client = yield* AgentSessionClient;
			return yield* client.prompt({ prompt: "hello" }).pipe(Stream.runCollect);
		}).pipe(Effect.provide(layer));

		const events = await Effect.runPromise(program);
		expect(events.map((event) => event.type)).toEqual([
			"agent_start",
			"agent_end",
		]);
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});

	test("ends the stream when prompting resolves without an agent_end event", async () => {
		const fake = makeFakeSession({ events: [{ type: "agent_start" }] });
		const layer = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const program = Effect.gen(function* () {
			const client = yield* AgentSessionClient;
			return yield* client.prompt({ prompt: "hello" }).pipe(Stream.runCollect);
		}).pipe(Effect.provide(layer));

		const events = await Effect.runPromise(program);
		expect(events.map((event) => event.type)).toEqual(["agent_start"]);
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});

	test("fails the stream with a typed adapter error when prompting fails", async () => {
		const fake = makeFakeSession({ promptError: new Error("no model") });
		const layer = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const program = Effect.gen(function* () {
			const client = yield* AgentSessionClient;
			return yield* client
				.prompt({ prompt: "hello" })
				.pipe(Stream.runCollect, Effect.exit);
		}).pipe(Effect.provide(layer));

		const exit = await Effect.runPromise(program);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const error = Cause.squash(exit.cause);
			expect(error).toBeInstanceOf(AgentSessionClientError);
			expect((error as AgentSessionClientError).phase).toBe("prompt");
		}
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});
});
