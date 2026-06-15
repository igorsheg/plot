import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { plotControlPackageName } from "@plot/control";
import { emptyProjection } from "@plot/control/projection";
import { safeParsePlotSessionSummary } from "@plot/control/session-summary";

describe("web control package boundary", () => {
	test("can consume browser-safe control schemas and projection helpers", () => {
		const projection = emptyProjection("session-1", "workflow");
		const summary = safeParsePlotSessionSummary({
			id: "session-1",
			epoch: "epoch-1",
			mode: "watch",
			state: "watching",
			workflowName: "workflow",
			workflowPath: "WORKFLOW.md",
			cwd: "/repo",
			cwdName: "repo",
			agents: { active: 0, max: 4 },
			needsYouCount: 0,
			tokenThroughputPerSecond: null,
			totalTokens: 0,
			lastActivityAt: null,
			attachments: { observers: 1, controllers: 0 },
		});

		expect(plotControlPackageName).toBe("@plot/control");
		expect(projection.sessionId).toBe("session-1");
		expect(summary.success).toBe(true);
	});

	test("web source does not import the session runtime package", async () => {
		const files = await collectFiles(join(import.meta.dir, "..", "src"));
		const contents = await Promise.all(
			files.map((file) => readFile(file, "utf8")),
		);
		expect(contents.join("\n")).not.toContain("@plot/session");
	});
});

const collectFiles = async (dir: string): Promise<string[]> => {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map((entry) => {
			const path = join(dir, entry.name);
			return entry.isDirectory() ? collectFiles(path) : [path];
		}),
	);
	return nested.flat().filter((path) => /\.(ts|tsx)$/.test(path));
};
