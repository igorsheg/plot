import { describe, expect, test } from "bun:test";
import type { WorkflowConfig } from "@plot/sdk";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ResolvedConfig } from "./config-service.js";

describe("ResolvedConfig.workspaceRoot", () => {
	test("relative path (./workspaces) resolves against projectDir, not cwd", () => {
		// Regression: when plot is spawned as a subprocess from a different
		// cwd (e.g. the desktop app), relative workspace.root used to land
		// inside the spawner's cwd instead of the project directory,
		// causing the agent to operate in the wrong repo entirely.
		const projectDir = "/tmp/fake-project-dir";
		const wf: WorkflowConfig = { workspace: { root: "./workspaces" } };
		const config = new ResolvedConfig(wf, undefined, projectDir);
		expect(config.workspaceRoot).toBe(resolve(projectDir, "./workspaces"));
	});

	test("absolute path is respected as-is", () => {
		const wf: WorkflowConfig = {
			workspace: { root: "/absolute/workspace/root" },
		};
		const config = new ResolvedConfig(wf, undefined, "/tmp/project");
		expect(config.workspaceRoot).toBe("/absolute/workspace/root");
	});

	test("bare name (no slash) resolves against projectDir", () => {
		const projectDir = "/tmp/other-project";
		const wf: WorkflowConfig = { workspace: { root: "workspaces" } };
		const config = new ResolvedConfig(wf, undefined, projectDir);
		expect(config.workspaceRoot).toBe(resolve(projectDir, "workspaces"));
	});

	test("tilde expansion uses $HOME", () => {
		const home = process.env["HOME"] ?? "/";
		const wf: WorkflowConfig = { workspace: { root: "~/plot-workspaces" } };
		const config = new ResolvedConfig(wf, undefined, "/tmp/project");
		expect(config.workspaceRoot).toBe(resolve(home, "plot-workspaces"));
	});

	test("missing workspace.root falls back to tmpdir", () => {
		const wf: WorkflowConfig = {};
		const config = new ResolvedConfig(wf, undefined, "/tmp/project");
		expect(config.workspaceRoot).toBe(resolve(tmpdir(), "plot_workspaces"));
	});
});
