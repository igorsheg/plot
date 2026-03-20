import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index.js";

const originalPath = process.env["PATH"];
const tempDirs: string[] = [];

afterEach(async () => {
	if (originalPath === undefined) {
		delete process.env["PATH"];
	} else {
		process.env["PATH"] = originalPath;
	}
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface GhFixtureIssue {
	number: number;
	title: string;
	body: string | null;
	state: string;
	labels: ReadonlyArray<{ name: string }>;
	url: string;
	createdAt: string;
	updatedAt: string;
}

const setupFakeGh = async (issues: GhFixtureIssue[], token = "fake-token") => {
	const dir = await mkdtemp(join(tmpdir(), "plot-gh-test-"));
	tempDirs.push(dir);
	const ghPath = join(dir, "gh");
	const issuesJson = JSON.stringify(issues);
	await writeFile(
		ghPath,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const cmd = args.join(" ");

if (args[0] === "auth" && args[1] === "token") {
  process.stdout.write("${token}");
  process.exit(0);
}

if (args[0] === "repo" && args[1] === "view") {
  process.stdout.write(JSON.stringify({ nameWithOwner: "test-owner/test-repo" }));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "list") {
  process.stdout.write(${JSON.stringify(issuesJson)});
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  const num = parseInt(args[2], 10);
  const issues = ${JSON.stringify(issuesJson)};
  const all = JSON.parse(issues);
  const found = all.find(i => i.number === num);
  if (!found) {
    process.stderr.write("issue not found (HTTP 404)");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(found));
  process.exit(0);
}

process.stderr.write("unexpected gh args: " + args.join(" "));
process.exit(1);
`,
	);
	await chmod(ghPath, 0o755);
	process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
};

const fetchCandidateIssues = async (options: {
	issuesFixture: ReadonlyArray<GhFixtureIssue>;
	dispatchStates: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) => {
	await setupFakeGh(options.issuesFixture as GhFixtureIssue[]);

	const config = await plugin.validateConfig!({
		kind: "github",
		dispatchStates: options.dispatchStates,
		parkedStates: options.parkedStates,
		terminalStates: options.terminalStates,
	});
	const client = await plugin.factory(config);
	return client.fetchCandidateIssues(options.dispatchStates);
};

describe("github tracker", () => {
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
