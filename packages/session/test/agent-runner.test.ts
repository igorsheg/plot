import { expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import { createAgentRunner, type AgentSession } from "../src/agent-runner.js";

class FakeAgentSession implements AgentSession {
	readonly prompts: {
		readonly text: string;
		readonly options?: PromptOptions;
	}[] = [];
	readonly listeners = new Set<(event: AgentSessionEvent) => void>();
	disposed = false;

	constructor(
		private readonly event: AgentSessionEvent = {
			type: "queue_update",
			steering: [],
			followUp: [],
		},
		private readonly eventCount = 1,
	) {}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string, options?: PromptOptions): Promise<void> {
		this.prompts.push({ text, ...(options === undefined ? {} : { options }) });
		for (let index = 0; index < this.eventCount; index++)
			for (const listener of this.listeners) listener(this.event);
	}

	dispose(): void {
		this.disposed = true;
	}
}

const context = (
	input: {
		readonly signal?: AbortSignal;
		readonly shouldContinue?: WorkRunnerContext["shouldContinue"];
		readonly reportActivity?: WorkRunnerContext["reportActivity"];
	} = {},
): WorkRunnerContext => {
	const source = "source";
	const key = "work-1";
	const result: WorkRunnerContext = {
		sourceId: source,
		tickId: 1,
		run: { runId: "run-1", sourceId: source, workKey: key },
		work: { workKey: key, templateContext: { name: "Ada" } },
		signal: input.signal ?? new AbortController().signal,
		reportActivity: input.reportActivity ?? (() => {}),
		shouldContinue: input.shouldContinue ?? (async () => false),
	};
	return result;
};

test("agent runner renders prompt, streams events, and disposes", async () => {
	const session = new FakeAgentSession();
	const events: AgentSessionEvent[] = [];
	let activityReports = 0;
	const runner = createAgentRunner({
		createAgentSession: async () => ({ session }),
		prompt: "Hello {{ name }}",
		create: async () => ({}),
		maxTurns: 20,
		onEvent: ({ event }) => {
			events.push(event);
		},
	});

	await runner.run(
		context({
			reportActivity: () => {
				activityReports++;
			},
		}),
	);

	expect(session.prompts).toEqual([{ text: "Hello Ada" }]);
	expect(events.map((event) => event["type"])).toEqual(["queue_update"]);
	expect(activityReports).toBe(1);
	expect(session.disposed).toBe(true);
});

test("agent runner reports every streamed event as activity", async () => {
	const session = new FakeAgentSession(
		{ type: "queue_update", steering: [], followUp: [] },
		3,
	);
	let activityReports = 0;
	const runner = createAgentRunner({
		createAgentSession: async () => ({ session }),
		prompt: "Start",
		create: async () => ({}),
		maxTurns: 20,
		onEvent: async () => {},
	});

	await runner.run(
		context({
			reportActivity: () => {
				activityReports++;
			},
		}),
	);

	expect(activityReports).toBe(3);
});

test("agent runner validates continuation turn bounds", async () => {
	const session = new FakeAgentSession();
	const runner = createAgentRunner({
		createAgentSession: async () => ({ session }),
		prompt: "Start",
		create: async () => ({}),
		maxTurns: 3,
		onEvent: async () => {},
	});

	await runner.run(
		context({
			shouldContinue: async (turn) => turn < 2,
		}),
	);

	expect(session.prompts).toHaveLength(2);
	expect(session.prompts[0]?.text).toBe("Start");
	expect(session.prompts[1]?.text).toContain("Continuation guidance");
});

test("agent runner rejects invalid turn bounds", async () => {
	const runner = createAgentRunner({
		createAgentSession: async () => ({ session: new FakeAgentSession() }),
		prompt: "Start",
		create: async () => ({}),
		maxTurns: 0,
		onEvent: async () => {},
	});

	await expect(runner.run(context())).rejects.toThrow("positive integer");
});
