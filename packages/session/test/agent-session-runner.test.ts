import { describe, expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { sourceId, tickId, workKey, runId } from "@plot/agent/model";
import { makeAgentSessionWorkRunner } from "../src/agent-session-runner.js";

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
		work: new Map(),
		running: new Map(),
	},
	signal: new AbortController().signal,
	emitObservation: () => true,
};

const iterable = async function* <A>(items: readonly A[]) {
	for (const item of items) yield item;
};

describe("agent session work runner", () => {
	test("keeps agent execution non-fatal when onEvent fails", async () => {
		const client = {
			prompt: () => iterable([{ type: "agent_start" } as AgentSessionEvent]),
		};

		const runner = await makeAgentSessionWorkRunner(
			{
				prompt: "do work",
				onEvent: () => Promise.reject("listener failed"),
			},
			client,
		);
		const result = await runner.run(context);

		expect(result).toEqual({});
	});

	test("forwards raw AgentSessionEvent values without wrapping", async () => {
		const events: AgentSessionEvent[] = [
			{ type: "agent_start" },
			{ type: "agent_end", messages: [], willRetry: false },
		];
		const seen: AgentSessionEvent[] = [];
		const prompts: string[] = [];
		const client = {
			prompt: (request: { prompt: string }) => {
				prompts.push(request.prompt);
				return iterable(events);
			},
		};

		const runner = await makeAgentSessionWorkRunner(
			{
				prompt: "do work",
				onEvent: (event) => {
					seen.push(event);
				},
			},
			client,
		);
		await runner.run(context);

		expect(prompts).toEqual(["do work"]);
		expect(seen).toEqual(events);
		expect(seen[0]).toBe(events[0]);
		expect(seen[1]).toBe(events[1]);
	});

	test("renders prompt templates with work template context", async () => {
		const prompts: string[] = [];
		const client = {
			prompt: (request: { prompt: string }) => {
				prompts.push(request.prompt);
				return iterable([{ type: "agent_start" } as AgentSessionEvent]);
			},
		};

		const runner = await makeAgentSessionWorkRunner(
			{
				prompt: "Review {{ repo }} PR #{{ pr.number }}",
			},
			client,
		);
		await runner.run({
			...context,
			work: {
				workKey: workKey("agent:1"),
				templateContext: { repo: "plot", pr: { number: 7 } },
			},
		});

		expect(prompts).toEqual(["Review plot PR #7"]);
	});
});
