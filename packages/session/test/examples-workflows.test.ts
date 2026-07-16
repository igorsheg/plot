import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseWorkflowText } from "../src/workflow.js";

// The shipped examples are the docs' load-bearing code; a Workflow that no
// longer parses is a docs regression, not just an example bug.
const examplesDir = resolve(import.meta.dir, "../../../examples");

const exampleWorkflows = readdirSync(examplesDir)
	.filter((name) => statSync(join(examplesDir, name)).isDirectory())
	.map((name) => join(examplesDir, name, "WORKFLOW.md"))
	.filter(existsSync);

describe("shipped example workflows", () => {
	test("ships file-backed Workflow examples", () => {
		expect(exampleWorkflows.length).toBeGreaterThan(0);
	});

	for (const path of exampleWorkflows) {
		test(`parses ${path.slice(examplesDir.length + 1)}`, () => {
			const workflow = parseWorkflowText(readFileSync(path, "utf8"), path);
			expect(workflow.runtime.extension?.source).toBeDefined();
			expect(workflow.prompt.length).toBeGreaterThan(0);
		});
	}
});
