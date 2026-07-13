import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { resolveSessionPaths } from "../src/paths.js";
import { inspectWorkflowExtensionReadiness } from "../src/readiness.js";
import { loadWorkflow } from "../src/workflow.js";

test("readiness checks requirements without discovering work", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-readiness-"));
	await writeFile(
		join(dir, "extension.ts"),
		`export default {
  id: "readiness-test",
  create: () => ({
    requirements: [{
      id: "auth",
      label: "Auth",
      check: () => ({
        status: "action-required",
        message: "Connect",
        actions: [{ id: "connect", label: "Connect" }],
      }),
    }],
    discover: () => { throw new Error("discover must not run"); },
  }),
};
`,
	);
	const workflowPath = join(dir, "WORKFLOW.md");
	await writeFile(
		workflowPath,
		`---
agent:
  provider: test
  model: fake
extension:
  source: ./extension.ts
---
Prompt
`,
	);

	const source = await inspectWorkflowExtensionReadiness({
		workflow: await loadWorkflow(workflowPath),
		paths: resolveSessionPaths({ cwd: dir }),
	});

	expect(source.readiness).toBe("action-required");
	expect(source.requirements[0]?.message).toBe("Connect");
	await rm(dir, { recursive: true, force: true });
});
