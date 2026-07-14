import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { prepareWorkflow } from "../src/preparation.js";

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

	const prepared = await prepareWorkflow({
		cwd: dir,
		workflowPath,
		skipAgentReadiness: true,
	});
	try {
		expect(prepared.source.readiness).toBe("action-required");
		expect(prepared.source.requirements[0]?.message).toBe("Connect");
	} finally {
		await prepared.close();
		await rm(dir, { recursive: true, force: true });
	}
});

test("readiness scopes Extension console output to diagnostics", async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-readiness-console-"));
	await writeFile(
		join(dir, "extension.ts"),
		`console.log("import output");
export default {
  id: "console-test",
  create: () => {
    console.info("create output");
    return {
      requirements: [{
        id: "ready",
        label: "Ready",
        check: () => {
          console.warn("check output");
          return { status: "ready" };
        },
      }],
      discover: () => [],
    };
  },
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
	const diagnostics: { stream: string; text: string }[] = [];
	try {
		const prepared = await prepareWorkflow({
			cwd: dir,
			workflowPath,
			skipAgentReadiness: true,
			diagnostic: (entry) => {
				diagnostics.push(entry);
			},
		});
		await prepared.close();
		expect(diagnostics).toEqual([
			{ stream: "stdout", text: "import output\n" },
			{ stream: "stdout", text: "create output\n" },
			{ stream: "stderr", text: "check output\n" },
		]);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
