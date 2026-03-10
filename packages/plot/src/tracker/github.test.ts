import { afterEach, describe, expect, test } from "bun:test";
import { TrackerClient } from "@plot/sdk";
import { Effect } from "effect";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeGithubTracker } from "./github.js";

const originalPath = process.env["PATH"];
const tempDirs: string[] = [];

afterEach(async () => {
	if (originalPath === undefined) {
		delete process.env["PATH"];
	} else {
		process.env["PATH"] = originalPath;
	}

	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

const fetchCandidateIssues = async (options: {
	issuesFixture: unknown;
	dispatchStates: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-gh-test-"));
	tempDirs.push(dir);

	const ghPath = join(dir, "gh");
	await writeFile(
		ghPath,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "issue" && args[1] === "list") {
  process.stdout.write(JSON.stringify(${JSON.stringify(options.issuesFixture)}));
  process.exit(0);
}
process.stderr.write("unexpected gh args: " + args.join(" "));
process.exit(1);
`,
	);
	await chmod(ghPath, 0o755);
	process.env["PATH"] = `${dir}:${originalPath ?? ""}`;

	return Effect.runPromise(
		Effect.gen(function* () {
			const tracker = yield* TrackerClient;
			return yield* tracker.fetchCandidateIssues(options.dispatchStates);
		}).pipe(
			Effect.provide(
				makeGithubTracker({
					dispatchStates: options.dispatchStates,
					parkedStates: options.parkedStates,
					terminalStates: options.terminalStates,
				}),
			),
		),
	);
};

describe("makeGithubTracker", () => {
	test("ignores open issues without a configured state label", async () => {
		const issues = await fetchCandidateIssues({
			issuesFixture: [
				{
					number: 1,
					title: "unlabeled",
					body: null,
					state: "OPEN",
					labels: [],
					url: "https://example.com/1",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
				{
					number: 2,
					title: "tracked",
					body: null,
					state: "OPEN",
					labels: [{ name: "plot:todo" }],
					url: "https://example.com/2",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
			],
			dispatchStates: ["plot:todo", "plot:in-progress"],
			parkedStates: ["plot:human-review"],
			terminalStates: ["plot:done", "Closed"],
		});

		expect(issues.map((issue) => issue.id)).toEqual(["2"]);
		expect(issues[0]?.state).toBe("plot:todo");
	});

	test("ignores open issues with only labels outside configured workflow states", async () => {
		const issues = await fetchCandidateIssues({
			issuesFixture: [
				{
					number: 1,
					title: "generic labels only",
					body: null,
					state: "OPEN",
					labels: [{ name: "bug" }, { name: "Todo" }],
					url: "https://example.com/1",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
				{
					number: 2,
					title: "tracked",
					body: null,
					state: "OPEN",
					labels: [{ name: "plot:in-progress" }, { name: "bug" }],
					url: "https://example.com/2",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
			],
			dispatchStates: ["plot:todo", "plot:in-progress"],
			parkedStates: ["plot:human-review"],
			terminalStates: ["plot:done", "Closed"],
		});

		expect(issues.map((issue) => issue.id)).toEqual(["2"]);
		expect(issues[0]?.state).toBe("plot:in-progress");
	});

	test("uses workflow-configured labels instead of built-in label names", async () => {
		const issues = await fetchCandidateIssues({
			issuesFixture: [
				{
					number: 1,
					title: "old plot label",
					body: null,
					state: "OPEN",
					labels: [{ name: "plot:todo" }],
					url: "https://example.com/1",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
				{
					number: 2,
					title: "custom workflow label",
					body: null,
					state: "OPEN",
					labels: [{ name: "queue:ready" }],
					url: "https://example.com/2",
					createdAt: "2026-03-10T00:00:00Z",
					updatedAt: "2026-03-10T00:00:00Z",
				},
			],
			dispatchStates: ["queue:ready", "queue:active"],
			parkedStates: ["queue:review"],
			terminalStates: ["queue:done", "Closed"],
		});

		expect(issues.map((issue) => issue.id)).toEqual(["2"]);
		expect(issues[0]?.state).toBe("queue:ready");
	});
});
