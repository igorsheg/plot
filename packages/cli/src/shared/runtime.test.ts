import { expect, test } from "bun:test";
import { toServerEnv } from "./runtime.js";

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
