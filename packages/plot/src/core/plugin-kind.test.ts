import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { classifyPluginKind } from "./plugin-kind.js";

const CWD = "/workspace/my-repo";

describe("classifyPluginKind", () => {
	describe("explicit npm: prefix", () => {
		test("scoped package", () => {
			const result = classifyPluginKind("npm:@wix/plot-jira-tracker", CWD);
			expect(result).toEqual({ type: "npm", specifier: "@wix/plot-jira-tracker" });
		});

		test("unscoped package", () => {
			const result = classifyPluginKind("npm:my-tracker", CWD);
			expect(result).toEqual({ type: "npm", specifier: "my-tracker" });
		});
	});

	describe("explicit file: prefix", () => {
		test("relative path", () => {
			const result = classifyPluginKind("file:./trackers/custom.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(CWD, "./trackers/custom.ts") });
		});

		test("absolute path", () => {
			const result = classifyPluginKind("file:/abs/path/tracker.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: "/abs/path/tracker.ts" });
		});

		test("tilde path", () => {
			const result = classifyPluginKind("file:~/my-trackers/custom.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(homedir(), "my-trackers/custom.ts") });
		});
	});

	describe("implicit local paths (no prefix)", () => {
		test("relative with dot-slash", () => {
			const result = classifyPluginKind("./trackers/custom.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(CWD, "./trackers/custom.ts") });
		});

		test("relative with dot-dot", () => {
			const result = classifyPluginKind("../shared/tracker.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(CWD, "../shared/tracker.ts") });
		});

		test("absolute path", () => {
			const result = classifyPluginKind("/home/user/trackers/custom.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: "/home/user/trackers/custom.ts" });
		});

		test("tilde path", () => {
			const result = classifyPluginKind("~/my-tracker/index.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(homedir(), "my-tracker/index.ts") });
		});

		test("bare tilde", () => {
			const result = classifyPluginKind("~tracker/index.ts", CWD);
			expect(result).toEqual({ type: "local", specifier: resolve(homedir(), "tracker/index.ts") });
		});
	});

	describe("implicit npm (no prefix, no path indicators)", () => {
		test("scoped package", () => {
			const result = classifyPluginKind("@wix/plot-jira-tracker", CWD);
			expect(result).toEqual({ type: "npm", specifier: "@wix/plot-jira-tracker" });
		});

		test("unscoped package", () => {
			const result = classifyPluginKind("my-tracker-plugin", CWD);
			expect(result).toEqual({ type: "npm", specifier: "my-tracker-plugin" });
		});
	});
});
