import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "./index.js";

const originalPath = process.env["PATH"];
const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
	if (originalPath === undefined) {
		delete process.env["PATH"];
	} else {
		process.env["PATH"] = originalPath;
	}
	await Promise.all(
		servers
			.splice(0)
			.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
	);
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const makeConfig = async (options: {
	beadsDir?: string;
	dispatchStates: ReadonlyArray<string>;
	parkedStates?: ReadonlyArray<string>;
	terminalStates?: ReadonlyArray<string>;
}) =>
	await plugin.validateConfig!({
		kind: "beads",
		beadsDir: options.beadsDir,
		dispatchStates: options.dispatchStates,
		parkedStates: options.parkedStates,
		terminalStates: options.terminalStates,
	});

const setupFakeBd = async (options: {
	issuesFixture: unknown;
	showFixture?: unknown;
	failOnShow?: boolean;
}) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-bd-test-"));
	tempDirs.push(dir);
	const bdPath = join(dir, "bd");
	await writeFile(
		bdPath,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "list" && args.includes("--json")) {
  process.stdout.write(JSON.stringify(${JSON.stringify(options.issuesFixture)}));
  process.exit(0);
}
if (args[0] === "show" && args.includes("--json")) {
  ${
		options.failOnShow
			? 'process.stderr.write("show should not be called"); process.exit(1);'
			: `process.stdout.write(JSON.stringify(${JSON.stringify(options.showFixture ?? options.issuesFixture)})); process.exit(0);`
	}
}
process.stderr.write("unexpected bd args: " + args.join(" "));
process.exit(1);
`,
	);
	await chmod(bdPath, 0o755);
	process.env["PATH"] = `${dir}:${originalPath ?? ""}`;
	return dir;
};

const setupFakeDaemon = async (issuesFixture: unknown) => {
	const dir = await mkdtemp(join(tmpdir(), "plot-bd-daemon-test-"));
	tempDirs.push(dir);
	const beadsDir = join(dir, ".beads");
	await mkdir(beadsDir, { recursive: true });
	const socketPath = join(beadsDir, "bd.sock");
	const server = createServer((socket) => {
		let request = "";
		socket.on("data", (chunk) => {
			request += chunk.toString();
			if (!request.includes("\n")) return;
			const parsed = JSON.parse(request.trim()) as {
				operation: string;
				args?: Record<string, unknown>;
			};
			if (parsed.operation === "list") {
				socket.end(JSON.stringify({ success: true, data: issuesFixture }) + "\n");
				return;
			}
			if (parsed.operation === "show") {
				const issueId = String(parsed.args?.["id"] ?? "");
				const issues = Array.isArray(issuesFixture) ? issuesFixture : [];
				const issue = issues.find(
					(candidate) =>
						typeof candidate === "object" &&
						candidate !== null &&
						"id" in candidate &&
						String(candidate.id) === issueId,
				);
				socket.end(JSON.stringify({ success: true, data: issue ?? null }) + "\n");
				return;
			}
			socket.end(JSON.stringify({ success: false, error: "unexpected operation" }) + "\n");
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => resolve());
	});
	servers.push(server);
	return dir;
};

describe("beads tracker", () => {
	test("returns issues matching configured workflow labels before status fallback", async () => {
		await setupFakeBd({
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
		});

		const config = await makeConfig({
			dispatchStates: ["plot:rework", "open"],
			parkedStates: ["blocked", "deferred"],
			terminalStates: ["closed"],
		});
		const client = await plugin.factory(config);
		const issues = await client.fetchCandidateIssues(config.dispatchStates ?? []);

		expect(issues.map((i) => i.id)).toEqual(["bd-a1b2", "bd-c3d4"]);
		expect(issues[0]?.state).toBe("open");
		expect(issues[1]?.state).toBe("plot:rework");
	});

	test("fetchCandidateIssues picks up closed issues and rework labels", async () => {
		await setupFakeBd({
			issuesFixture: [
				{
					id: "bd-open1",
					title: "open task",
					description: "",
					status: "open",
					priority: 1,
					labels: [],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
				{
					id: "bd-done1",
					title: "done task",
					description: "",
					status: "done",
					priority: 1,
					labels: [],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
				{
					id: "bd-rework1",
					title: "rework task",
					description: "",
					status: "done",
					priority: 1,
					labels: ["plot:rework"],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
			],
		});

		const config = await makeConfig({
			dispatchStates: ["open", "plot:rework", "done"],
			parkedStates: ["blocked"],
			terminalStates: ["closed"],
		});
		const client = await plugin.factory(config);
		const issues = await client.fetchCandidateIssues(config.dispatchStates ?? []);

		expect(issues.map((i) => i.id)).toEqual(["bd-open1", "bd-done1", "bd-rework1"]);
		expect(issues[0]?.state).toBe("open");
		expect(issues[1]?.state).toBe("done");
		expect(issues[2]?.state).toBe("plot:rework");
	});

	test("maps beads issue fields to TrackerIssue", async () => {
		await setupFakeBd({
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
		});

		const config = await makeConfig({ dispatchStates: ["open"] });
		const client = await plugin.factory(config);
		const issues = await client.fetchCandidateIssues(config.dispatchStates ?? []);

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

	test("fetchIssueStatesByIds batches through list and does not call show", async () => {
		await setupFakeBd({
			issuesFixture: [
				{
					id: "bd-1",
					title: "first",
					description: "",
					status: "open",
					priority: 2,
					labels: [],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
				{
					id: "bd-2",
					title: "second",
					description: "",
					status: "blocked",
					priority: 2,
					labels: ["plot:rework"],
					created_at: "2026-03-10T00:00:00Z",
					updated_at: "2026-03-10T00:00:00Z",
					assignee: "",
				},
			],
			failOnShow: true,
		});

		const config = await makeConfig({
			dispatchStates: ["open", "plot:rework"],
			parkedStates: ["blocked"],
			terminalStates: ["closed"],
		});
		const client = await plugin.factory(config);
		const states = await client.fetchIssueStatesByIds!(["bd-1", "bd-2", "bd-missing"]);

		expect(states).toEqual([
			{ id: "bd-1", state: "open" },
			{ id: "bd-2", state: "plot:rework" },
		]);
	});

	test("uses beads daemon transport when a socket is available", async () => {
		const workspaceRoot = await setupFakeDaemon([
			{
				id: "bd-daemon-1",
				title: "daemon issue",
				description: "via daemon",
				status: "open",
				priority: 1,
				labels: [],
				comments: [],
				created_at: "2026-03-10T00:00:00Z",
				updated_at: "2026-03-10T00:00:00Z",
				assignee: "",
			},
		]);

		const config = await makeConfig({
			beadsDir: workspaceRoot,
			dispatchStates: ["open"],
		});
		const client = await plugin.factory(config);
		const issues = await client.fetchCandidateIssues(config.dispatchStates ?? []);

		expect(issues.map((issue) => issue.id)).toEqual(["bd-daemon-1"]);
	});
});
