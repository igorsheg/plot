import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
	WorkflowFileSystem,
	loadWorkflow,
	parseWorkflowText,
} from "../src/workflow.js";

describe("workflow contract", () => {
	test("parses YAML front matter and preserves markdown prompt body", async () => {
		const workflow = await Effect.runPromise(
			parseWorkflowText(
				`---
agent:
  max_concurrent: 2
tracker:
  states:
    - Todo
---

# Review work

Use the current task context.
`,
				"WORKFLOW.md",
			),
		);

		expect(workflow.path).toBe("WORKFLOW.md");
		expect(workflow.config).toEqual({
			agent: { max_concurrent: 2 },
			tracker: { states: ["Todo"] },
		});
		expect(workflow.prompt).toBe(
			"# Review work\n\nUse the current task context.",
		);
	});

	test("loads workflow content through an injected file system service", async () => {
		const workflow = await Effect.runPromise(
			loadWorkflow("custom/WORKFLOW.md").pipe(
				Effect.provide(
					Layer.succeed(WorkflowFileSystem, {
						readFileString: (path) =>
							Effect.succeed(`---\npath: ${path}\n---\n\nDo it.`),
					}),
				),
			),
		);

		expect(workflow).toEqual({
			config: { path: "custom/WORKFLOW.md" },
			path: "custom/WORKFLOW.md",
			prompt: "Do it.",
		});
	});
});
