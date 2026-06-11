import { describe, expect, test } from "bun:test";
import { sourceId, tickId, workKey, runId } from "@plot/agent/model";
import {
	makePromptTemplateData,
	renderPromptTemplate,
	renderPromptTemplateForRunnerContext,
} from "../src/workflow-template.js";

const makeContext = (templateContext?: unknown) => ({
	sourceId: sourceId("template-source"),
	tickId: tickId(1),
	run: {
		runId: runId("run-1"),
		sourceId: sourceId("template-source"),
		workKey: workKey("template:1"),
	},
	work: {
		workKey: workKey("template:1"),
		...(templateContext === undefined ? {} : { templateContext }),
	},
	snapshot: {
		tickId: tickId(1),
		facts: new Map(),
		observations: [],
		completions: [],
		diagnostics: [],
		running: new Map(),
	},
	signal: new AbortController().signal,
	emitObservation: () => true,
});

describe("workflow prompt templates", () => {
	test("renders moustache-style Eta expressions from work context", async () => {
		const result = await renderPromptTemplateForRunnerContext(
			"Review {{ repo }} PR #{{ pr.number }}: {{ pr.title }}",
			makeContext({
				repo: "plot",
				pr: { number: 42, title: "template prompts" },
			}),
		);

		expect(result).toBe("Review plot PR #42: template prompts");
	});

	test("fails when templates reference missing variables", async () => {
		await expect(
			renderPromptTemplate("Review {{ repo }}", {}),
		).rejects.toThrow();
	});

	test("wraps scalar work context as value", () => {
		expect(makePromptTemplateData(makeContext("alpha"))).toEqual({
			value: "alpha",
		});
	});
});
