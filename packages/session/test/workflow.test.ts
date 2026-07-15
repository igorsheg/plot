import { describe, expect, test } from "bun:test";
import {
	DEFAULT_WORKFLOW_PATH,
	WorkflowBoundaryError,
	loadWorkflow,
	parseWorkflowText,
	resolveWorkflowPath,
} from "../src/workflow.js";

describe("workflow", () => {
	test("parses YAML front matter, runtime config, and prompt body", () => {
		const workflow = parseWorkflowText(
			`---
plot:
  maxRunDurationMs: 1000
agent:
  provider: anthropic
  model: claude-opus-4-8
  maxTurns: 3
extension:
  source: ./extension.ts
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
		);

		expect(workflow.path).toBe("WORKFLOW.md");
		expect(workflow.config["tracker"]).toEqual({ states: ["Todo"] });
		expect(workflow.runtime).toEqual({
			plot: { maxRunDurationMs: 1000 },
			agent: { provider: "anthropic", model: "claude-opus-4-8", maxTurns: 3 },
			extension: { source: "./extension.ts", config: { repo: "web" } },
			resources: { skills: [".plot/skills/review"] },
		});
		expect(workflow.prompt).toBe(
			"# Review work\n\nUse the current task context.",
		);
	});

	test("rejects invalid runtime config at the YAML boundary", () => {
		expect(() =>
			parseWorkflowText(
				`---\nplot:\n  maxRunDurationMs: nope\nextension:\n  source: ./extension.ts\n---\nDo it.`,
			),
		).toThrow(WorkflowBoundaryError);
	});

	test("requires an Extension", () => {
		expect(() => parseWorkflowText("Do it.")).toThrow(
			"WORKFLOW.md requires an extension with at least one Source.",
		);
	});

	test("requires Workflow-owned provider and model policy", () => {
		expect(() =>
			parseWorkflowText(
				`---\nextension:\n  source: ./extension.ts\n---\nDo it.`,
			),
		).toThrow("WORKFLOW.md requires agent.provider and agent.model.");
	});

	test("runtime validation errors name nested fields", () => {
		expect(() =>
			parseWorkflowText(
				`---\nagent:\n  provider: test\n  model: fake\n  maxTurns: nope\nextension:\n  source: ./extension.ts\n---\nDo it.`,
				"WORKFLOW.md",
			),
		).toThrow(/runtime\.agent\.maxTurns/);
	});

	test("loads through injected file system and resolves discovery paths", async () => {
		const workflow = await loadWorkflow("custom/WORKFLOW.md", {
			readFileString: async (path) =>
				`---\nname: ${path}\nagent:\n  provider: test\n  model: fake\nextension:\n  source: ./extension.ts\n---\n\nDo it.`,
		});

		expect(workflow.runtime).toEqual({
			name: "custom/WORKFLOW.md",
			agent: { provider: "test", model: "fake" },
			extension: { source: "./extension.ts" },
		});
		expect(workflow.prompt).toBe("Do it.");
		expect(resolveWorkflowPath({ cwd: "/repo" })).toBe(
			`/repo/${DEFAULT_WORKFLOW_PATH}`,
		);
		expect(
			resolveWorkflowPath({ cwd: "/repo", workflowPath: "ops/review.md" }),
		).toBe("/repo/ops/review.md");
		expect(
			resolveWorkflowPath({ cwd: "/repo", workflowPath: "/tmp/WORKFLOW.md" }),
		).toBe("/tmp/WORKFLOW.md");
	});
});
