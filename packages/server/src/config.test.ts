import { describe, expect, test } from "bun:test";
import { readConfigFromEnv } from "./config.js";

describe("readConfigFromEnv", () => {
	test("reads web config from env", () => {
		const config = readConfigFromEnv({
			PLOT_PORT: "4123",
			PLOT_WEB_DIST_DIR: "/tmp/plot-web",
			PLOT_WEB_ENABLED: "true",
		});

		expect(config.port).toBe(4123);
		expect(config.webDistDir).toBe("/tmp/plot-web");
		expect(config.webEnabled).toBe(true);
	});
});
