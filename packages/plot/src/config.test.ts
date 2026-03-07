import { describe, expect, test } from "bun:test";
import { readConfigFromEnv } from "./config.js";

describe("readConfigFromEnv", () => {
	test("reads explicit web config from env", () => {
		const config = readConfigFromEnv({
			PLOT_PORT: "4123",
			PLOT_WEB_DIST_DIR: "/tmp/plot-web",
			PLOT_WEB_ENABLED: "true",
		});

		expect(config.port).toBe(4123);
		expect(config.webDistDir).toBe("/tmp/plot-web");
		expect(config.webEnabled).toBe(true);
	});

	test("uses defaults when env is missing", () => {
		const config = readConfigFromEnv({});

		expect(config.workflowPath).toBe("./WORKFLOW.md");
		expect(config.port).toBe(3000);
		expect(config.issuesDir).toBe("./issues");
		expect(config.webEnabled).toBe(false);
		expect(config.logFormat).toBe("pretty");
		expect(config.logLevel).toBe("info");
		expect(config.trackerKind).toBe("local-fs");
	});

	test("falls back for invalid enum values", () => {
		const config = readConfigFromEnv({
			PLOT_LOG_FORMAT: "yaml",
			PLOT_LOG_LEVEL: "trace",
			PLOT_TRACKER_KIND: "jira",
		});

		expect(config.logFormat).toBe("pretty");
		expect(config.logLevel).toBe("info");
		expect(config.trackerKind).toBe("local-fs");
	});

	test("throws on invalid ports", () => {
		expect(() => readConfigFromEnv({ PLOT_PORT: "70000" })).toThrow(
			"invalid PLOT_PORT: 70000",
		);
		expect(() => readConfigFromEnv({ PLOT_PORT: "wat" })).toThrow(
			"invalid PLOT_PORT: wat",
		);
	});
});
