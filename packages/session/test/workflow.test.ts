import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
	DEFAULT_WORKFLOW_PATH,
	WorkflowFileSystem,
	loadWorkflow,
	parseWorkflowText,
	resolveWorkflowPath,
} from "../src/workflow.js";

describe("workflow contract", () => {
	test("parses YAML front matter and preserves markdown prompt body", async () => {
		const workflow = await Effect.runPromise(
			parseWorkflowText(
				`---
plot:
  maxRunDurationMs: 1000
agent:
  provider: plot-faux
  model: faux-1
extension:
  source: npm:@acme/plot-github-pr-reviewer
  config:
    repo: web
resources:
  skills:
    - .plot/skills/review
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
			plot: { maxRunDurationMs: 1000 },
			agent: { provider: "plot-faux", model: "faux-1" },
			extension: {
				source: "npm:@acme/plot-github-pr-reviewer",
				config: { repo: "web" },
			},
			resources: { skills: [".plot/skills/review"] },
			tracker: { states: ["Todo"] },
		});
		expect(workflow.runtime).toEqual({
			plot: { maxRunDurationMs: 1000 },
			agent: { provider: "plot-faux", model: "faux-1" },
			extension: {
				source: "npm:@acme/plot-github-pr-reviewer",
				config: { repo: "web" },
			},
			resources: { skills: [".plot/skills/review"] },
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
			runtime: {},
			path: "custom/WORKFLOW.md",
			prompt: "Do it.",
		});
	});

	test("resolves workflow discovery relative to the project cwd", () => {
		expect(resolveWorkflowPath({ cwd: "/repo" })).toBe(
			`/repo/${DEFAULT_WORKFLOW_PATH}`,
		);
		expect(
			resolveWorkflowPath({ cwd: "/repo", workflowPath: "ops/review.md" }),
		).toBe("/repo/ops/review.md");
		expect(
			resolveWorkflowPath({
				cwd: "/repo",
				workflowPath: "/tmp/WORKFLOW.md",
			}),
		).toBe("/tmp/WORKFLOW.md");
	});
});
