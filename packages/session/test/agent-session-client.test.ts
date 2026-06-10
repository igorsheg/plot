import { describe, expect, test } from "bun:test";
import type {
	AgentSession,
	AgentSessionEvent,
	AgentSessionEventListener,
	CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import {
	AgentSessionClientError,
	makeAgentSessionClientLayer,
} from "../src/agent-session-client.js";

const fakeResult = (session: AgentSession) =>
	({ session, extensionsResult: {} }) as unknown as CreateAgentSessionResult;

const collect = async <A>(iterable: AsyncIterable<A>): Promise<A[]> => {
	const items: A[] = [];
	for await (const item of iterable) items.push(item);
	return items;
};

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
		const client = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const events = await collect(client.prompt({ prompt: "hello" }));
		expect(events.map((event) => event.type)).toEqual([
			"agent_start",
			"agent_end",
		]);
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});

	test("ends the stream when prompting resolves without an agent_end event", async () => {
		const fake = makeFakeSession({ events: [{ type: "agent_start" }] });
		const client = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		const events = await collect(client.prompt({ prompt: "hello" }));
		expect(events.map((event) => event.type)).toEqual(["agent_start"]);
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});

	test("fails the stream with a typed adapter error when prompting fails", async () => {
		const fake = makeFakeSession({ promptError: new Error("no model") });
		const client = makeAgentSessionClientLayer({
			createAgentSession: async () => fakeResult(fake.session),
		});

		let error: unknown;
		try {
			await collect(client.prompt({ prompt: "hello" }));
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(AgentSessionClientError);
		expect((error as AgentSessionClientError).phase).toBe("prompt");
		expect(fake.state()).toEqual({ disposed: true, unsubscribed: true });
	});
});
