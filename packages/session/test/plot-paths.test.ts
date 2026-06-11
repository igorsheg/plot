import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolvePlotPaths } from "../src/plot-paths.js";

describe("Plot paths", () => {
	test("keeps project state local while auth/model agent state defaults global", () => {
		const paths = resolvePlotPaths({ cwd: "/tmp/plot-project" });

		expect(paths.plotDir).toBe(resolve("/tmp/plot-project/.plot"));
		expect(paths.sessionDir).toBe(resolve("/tmp/plot-project/.plot/sessions"));
		expect(paths.agentDir).toBe(resolve(homedir(), ".plot/agent"));
	});

	test("allows explicit project-local agent state", () => {
		const paths = resolvePlotPaths({
			cwd: "/tmp/plot-project",
			agentDir: ".plot/agent",
		});

		expect(paths.agentDir).toBe(resolve("/tmp/plot-project/.plot/agent"));
	});
});
