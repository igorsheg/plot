import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Issue } from "@plot/sdk";
import { compilePrompt } from "./prompt-compiler.js";
import { buildTrackerRunContext } from "./workpad-context.js";

const issue = new Issue({
	id: "1",
	identifier: "#1",
	title: "stabilize prompt compiler",
	description: "agent should get structured issue payload",
	state: "plot:in-progress",
	url: null,
	labels: ["ai", "orchestration"],
	blockedBy: [],
	createdAt: null,
	updatedAt: null,
});

describe("compilePrompt", () => {
	test("splits stable system policy from volatile user context", async () => {
		const runContext = buildTrackerRunContext({
			workpad: `## Plot Workpad

### Plan

- [ ] tighten prompt sections

### Latest Attempt Summary

- changed: none
- validated: none
- failed: looped on retries
- blocked: none`,
			reviewFeedback: "need clearer retry context",
		});

		const compiled = await Effect.runPromise(
			compilePrompt(
				"follow the repository workflow carefully. attempt={{ attempt }}",
				issue,
				2,
				runContext,
			),
		);

		expect(compiled.systemPrompt).toContain("plot operating contract");
		expect(compiled.systemPrompt).toContain("workflow policy");
		expect(compiled.userPrompt).toContain("issue payload");
		expect(compiled.userPrompt).toContain("tracker workpad context");
		expect(compiled.userPrompt).toContain("retry #2");
		expect(compiled.snapshot.systemSections).toHaveLength(3);
		expect(compiled.snapshot.userSections).toHaveLength(3);
		expect(compiled.snapshot.stablePrefixHash.length).toBeGreaterThan(8);
	});
});
