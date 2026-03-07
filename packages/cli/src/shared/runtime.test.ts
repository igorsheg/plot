import { afterEach, expect, test } from "bun:test";
import {
	buildSelfCommandArgs,
	normalizeCliProcessArgv,
	resolveBundledPiSkillsDir,
	resolveCliArgs,
	stripBundledEntryArg,
	toServerEnv,
} from "./runtime.js";

const originalPiSkillsDir = process.env["PLOT_PI_SKILLS_DIR"];

afterEach(() => {
	if (originalPiSkillsDir === undefined) {
		delete process.env["PLOT_PI_SKILLS_DIR"];
		return;
	}
	process.env["PLOT_PI_SKILLS_DIR"] = originalPiSkillsDir;
});

test("toServerEnv prefers json logs for machine mode", () => {
	const env = toServerEnv({
		json: true,
		quiet: false,
		port: 3000,
		workflow: "./WORKFLOW.md",
		tracker: "local-fs",
		"issues-dir": "./issues",
		"log-format": "pretty",
		"log-level": "info",
	});

	expect(env["PLOT_LOG_FORMAT"]).toBe("json");
	expect(env["PLOT_WEB_ENABLED"]).toBe("0");
});

test("toServerEnv keeps explicit log format for human mode", () => {
	const env = toServerEnv({
		json: false,
		quiet: true,
		port: 3000,
		workflow: "./WORKFLOW.md",
		tracker: "local-fs",
		"issues-dir": "./issues",
		"log-format": "pretty",
		"log-level": "none",
	});

	expect(env["PLOT_LOG_FORMAT"]).toBe("pretty");
	expect(env["PLOT_LOG_LEVEL"]).toBe("none");
});

test("toServerEnv passes through a pi skills dir override", () => {
	process.env["PLOT_PI_SKILLS_DIR"] = "/tmp/custom-skills";

	const env = toServerEnv({
		json: false,
		quiet: false,
		port: 3000,
		workflow: "./WORKFLOW.md",
		tracker: "local-fs",
		"issues-dir": "./issues",
		"log-format": "pretty",
		"log-level": "info",
	});

	expect(env["PLOT_PI_SKILLS_DIR"]).toBe("/tmp/custom-skills");
});

test("resolveBundledPiSkillsDir falls back to the bundled skills path", () => {
	delete process.env["PLOT_PI_SKILLS_DIR"];

	expect(resolveBundledPiSkillsDir()).toEndWith("/pi-package/skills");
});

test("toServerEnv enables static web hosting only when requested", () => {
	const env = toServerEnv({
		json: false,
		quiet: false,
		port: 3000,
		workflow: "./WORKFLOW.md",
		tracker: "local-fs",
		"issues-dir": "./issues",
		"log-format": "pretty",
		"log-level": "info",
		web: true,
	});

	expect(env["PLOT_WEB_ENABLED"]).toBe("1");
});

test("stripBundledEntryArg drops bunfs argv entries", () => {
	expect(stripBundledEntryArg(["/$bunfs/root/index.js", "serve"])).toEqual([
		"serve",
	]);
});

test("buildSelfCommandArgs skips bunfs entrypoints in compiled builds", () => {
	expect(
		buildSelfCommandArgs(
			"/tmp/plot-ai",
			"/$bunfs/root/index.js",
			"__internal-server",
		),
	).toEqual(["/tmp/plot-ai", "__internal-server"]);
});

test("resolveCliArgs drops script entries but keeps standalone argv", () => {
	expect(resolveCliArgs(["bun", "/tmp/index.ts", "serve"])).toEqual(["serve"]);
	expect(resolveCliArgs(["/tmp/plot-ai", "serve", "--json"])).toEqual([
		"serve",
		"--json",
	]);
});

test("normalizeCliProcessArgv gives effect cli a stable argv shape", () => {
	expect(normalizeCliProcessArgv(["/tmp/plot-ai", "serve"])).toEqual([
		"/tmp/plot-ai",
		"/tmp/plot-ai",
		"serve",
	]);
});
