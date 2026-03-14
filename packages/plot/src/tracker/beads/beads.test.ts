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
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

const setupFakeBd = async (issuesFixture: unknown) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-bd-test-"));
	tempDirs.push(dir);
	const bdPath = join(dir, "bd");
	await writeFile(
		bdPath,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "list" && args.includes("--json")) {
  process.stdout.write(JSON.stringify(${JSON.stringify(issuesFixture)}));
  process.exit(0);
}
process.stderr.write("unexpected bd args: " + args.join(" "));
process.exit(1);
`,
	);
	await chmod(bdPath, 0o755);
	process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
};

const fetchCandidateIssues = async (options: {
	issuesFixture: unknown;
	dispatchStates: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) => {
	await setupFakeBd(options.issuesFixture);

	const config = await plugin.validateConfig!({
		kind: "beads",
		dispatchStates: options.dispatchStates,
		parkedStates: options.parkedStates,
		terminalStates: options.terminalStates,
	});
	const client = await plugin.factory(config);
	return client.fetchCandidateIssues(options.dispatchStates);
};

describe("beads tracker", () => {
	test("returns issues matching configured workflow labels before status fallback", async () => {
		const issues = await fetchCandidateIssues({
			issuesFixture: [
				{
					id: "bd-a1b2",
					title: "first task",
					description: "do the thing",
					status: "open",
					priority: 2,
					labels: [],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
				{
					id: "bd-c3d4",
					title: "rework task",
					description: "",
					status: "open",
					priority: 1,
					labels: ["plot:rework"],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
				{
					id: "bd-e5f6",
					title: "blocked task",
					description: "",
					status: "blocked",
					priority: 1,
					labels: ["bug"],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
			],
			dispatchStates: ["plot:rework", "open"],
			parkedStates: ["blocked", "deferred"],
			terminalStates: ["closed"],
		});

		expect(issues.map((i) => i.id)).toEqual(["bd-a1b2", "bd-c3d4"]);
		expect(issues[0]?.state).toBe("open");
		expect(issues[1]?.state).toBe("plot:rework");
	});

	test("maps beads issue fields to IssueLike", async () => {
		const issues = await fetchCandidateIssues({
			issuesFixture: [
				{
					id: "bd-x1y2",
					title: "test issue",
					description: "some description",
					status: "open",
					priority: 0,
					labels: ["Frontend", "P0"],
					created_at: "2026-03-10T12:00:00Z",
					updated_at: "2026-03-10T13:00:00Z",
					assignee: "agent-1",
				},
			],
			dispatchStates: ["open"],
		});

		expect(issues).toHaveLength(1);
		const issue = issues[0]!;
		expect(issue.id).toBe("bd-x1y2");
		expect(issue.identifier).toBe("bd-x1y2");
		expect(issue.title).toBe("test issue");
		expect(issue.description).toBe("some description");
		expect(issue.state).toBe("open");
		expect(issue.url).toBeNull();
		expect(issue.labels).toEqual(["frontend", "p0"]);
		expect(issue.createdAt).toBe("2026-03-10T12:00:00Z");
		expect(issue.updatedAt).toBe("2026-03-10T13:00:00Z");
	});
});
