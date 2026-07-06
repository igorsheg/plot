import { expect, test } from "bun:test";
import type {
	AgentSessionEvent,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import type { RuntimeSnapshot } from "@plot/agent/model";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import {
	PiWorkRunnerError,
	makePiWorkRunner,
	type PiAgentSessionPort,
} from "../src/pi-runner.js";

class FakePiSession implements PiAgentSessionPort {
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
	) {}

	subscribe(listener: (event: AgentSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async prompt(text: string, options?: PromptOptions): Promise<void> {
		this.prompts.push({ text, ...(options === undefined ? {} : { options }) });
		for (const listener of this.listeners) listener(this.event);
	}

	dispose(): void {
		this.disposed = true;
	}
}

const snapshot: RuntimeSnapshot = {
	tickId: 1,
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	work: new Map(),
	running: new Map(),
};

const context = (
	input: {
		readonly signal?: AbortSignal;
		readonly shouldContinue?: WorkRunnerContext["shouldContinue"];
		readonly emitObservation?: WorkRunnerContext["emitObservation"];
	} = {},
): WorkRunnerContext => {
	const source = "source";
	const key = "work-1";
	return {
		sourceId: source,
		tickId: 1,
		run: { runId: "run-1", sourceId: source, workKey: key },
		work: { workKey: key, templateContext: { name: "Ada" } },
		snapshot,
		signal: input.signal ?? new AbortController().signal,
		emitObservation: input.emitObservation ?? (async () => true),
		...(input.shouldContinue === undefined
			? {}
			: { shouldContinue: input.shouldContinue }),
	};
};

test("pi runner renders prompt, streams events, and disposes", async () => {
	const session = new FakePiSession();
	const events: AgentSessionEvent[] = [];
	let observations = 0;
	const runner = makePiWorkRunner({
		createAgentSession: async () => ({ session }),
		prompt: "Hello {{ name }}",
		promptOptions: { expandPromptTemplates: false },
		onEvent: ({ event }) => {
			events.push(event);
		},
	});

	await runner.run(
		context({
			emitObservation: async () => {
				observations++;
				return true;
			},
		}),
	);

	expect(session.prompts).toEqual([
		{ text: "Hello Ada", options: { expandPromptTemplates: false } },
	]);
	expect(events.map((event) => event["type"])).toEqual(["queue_update"]);
	expect(observations).toBe(1);
	expect(session.disposed).toBe(true);
});

test("pi runner validates continuation turn bounds", async () => {
	const session = new FakePiSession();
	const runner = makePiWorkRunner({
		createAgentSession: async () => ({ session }),
		prompt: "Start",
		maxTurns: 3,
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

test("pi runner fails on invalid maxTurns", async () => {
	const runner = makePiWorkRunner({
		createAgentSession: async () => ({ session: new FakePiSession() }),
		prompt: "Start",
		maxTurns: 0,
	});

	await expect(runner.run(context())).rejects.toBeInstanceOf(PiWorkRunnerError);
});
