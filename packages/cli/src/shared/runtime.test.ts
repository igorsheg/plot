import { expect, test } from "bun:test";
import {
	buildSelfCommandArgs,
	resolveBundledPiSkillsDir,
	stripBundledEntryArg,
	toServerEnv,
} from "./runtime.js";

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

test("toServerEnv passes the bundled pi skills dir", () => {
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

	expect(env["PLOT_PI_SKILLS_DIR"]).toBe(resolveBundledPiSkillsDir());
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
