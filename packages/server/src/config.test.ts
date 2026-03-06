import { describe, expect, test } from "bun:test";
import { readConfigFromEnv } from "./config.js";

describe("readConfigFromEnv", () => {
	test("reads web dist dir from env", () => {
		const config = readConfigFromEnv({
			PLOT_PORT: "4123",
			PLOT_WEB_DIST_DIR: "/tmp/plot-web",
		});

		expect(config.port).toBe(4123);
		expect(config.webDistDir).toBe("/tmp/plot-web");
	});
});
