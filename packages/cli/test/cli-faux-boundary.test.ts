import { afterEach, describe, expect, test } from "bun:test";
import {
	decodePlotServerRecord,
	plotProtocolVersion,
} from "@plot/session/protocol";
import { writePlotFauxAgentFiles } from "@plot/session/testing/faux-agent-session";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const tempDirs: string[] = [];
const textDecoder = new TextDecoder();

const makeWorkflowFile = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-cli-faux-"));
	tempDirs.push(dir);
	const path = join(dir, "WORKFLOW.md");
	await writeFile(
		path,
		[
			"---",
			"name: cli-faux",
			"agent:",
			"  noTools: false",
			"---",
			"Run the workflow.",
			"",
		].join("\n"),
	);
	await writePlotFauxAgentFiles({ cwd: dir });
	return { dir, path };
};

const decodeLines = (text: string) =>
	Promise.all(
		text
			.split("\n")
			.filter((line) => line.length > 0)
			.map((line) => decodePlotServerRecord(JSON.parse(line) as unknown)),
	);

const eventType = (record: unknown) => {
	if (
		record === null ||
		typeof record !== "object" ||
		!("kind" in record) ||
		record.kind !== "session_event" ||
		!("event" in record)
	)
		return undefined;
	const event = record.event;
	if (event === null || typeof event !== "object" || !("type" in event))
		return undefined;
	return event.type;
};

const waitForStdout = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	predicate: (text: string) => boolean,
) => {
	let stdout = "";
	while (!predicate(stdout)) {
		// Stream reads are intentionally sequential.
		// eslint-disable-next-line no-await-in-loop
		const result = await Promise.race([
			reader.read(),
			new Promise<"timeout">((resolve) =>
				setTimeout(() => resolve("timeout"), 5_000),
			),
		]);
		if (result === "timeout") throw new Error("timed out waiting for stdout");
		if (result.done) throw new Error("stdout ended before predicate matched");
		stdout += textDecoder.decode(result.value, { stream: true });
	}
	return stdout;
};

const drainStdout = async (
	reader: ReadableStreamDefaultReader<Uint8Array>,
	initial: string,
) => {
	let stdout = initial;
	for (;;) {
		// Stream reads are intentionally sequential.
		// eslint-disable-next-line no-await-in-loop
		const result = await reader.read();
		if (result.done) break;
		stdout += textDecoder.decode(result.value, { stream: true });
	}
	stdout += textDecoder.decode();
	return stdout;
};

describe("plot CLI faux provider boundary", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("runs WORKFLOW.md through the explicit no-server escape hatch with the production Plot pi factory", async () => {
		const workflow = await makeWorkflowFile();
		const child = Bun.spawn(
			[
				"bun",
				fileURLToPath(new URL("../src/testing-main.ts", import.meta.url)),
				"run",
				"--workflow",
				workflow.path,
				"--cwd",
				workflow.dir,
				"--agent-dir",
				join(workflow.dir, ".plot/agent"),
				"--log-format",
				"json",
				"--log-level",
				"info",
				"--provider",
				"plot-faux",
				"--model",
				"faux-1",
				"--no-tools",
				"--no-server",
			],
			{
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					PLOT_FAUX_API_KEY: "plot-faux-key",
					PLOT_FAUX_RESPONSE_TEXT: "hello from plot run",
				},
			},
		);

		const stdoutReader = child.stdout.getReader();
		const partialStdout = await waitForStdout(stdoutReader, (text) =>
			text.includes("Completed work workflow:default: succeeded"),
		);
		child.kill();

		const [stdout, stderr] = await Promise.all([
			drainStdout(stdoutReader, partialStdout),
			new Response(child.stderr).text(),
			child.exited,
		]);

		expect(stdout).toContain("Started work workflow:default");
		expect(stdout).toContain("Final assistant message:");
		expect(stdout).toContain("hello from plot run");
		expect(stdout).toContain("Completed work workflow:default: succeeded");
		expect(stdout).not.toContain("Workflow cli-faux finished with succeeded");
		expect(stderr).not.toContain("plot_cli.run_control_oneshot");
	});

	test("exercises the production Plot pi factory with a deterministic faux provider", async () => {
		const workflow = await makeWorkflowFile();
		const child = Bun.spawn(
			[
				"bun",
				fileURLToPath(new URL("../src/testing-main.ts", import.meta.url)),
				"_serve",
				"stdio",
				"--workflow",
				workflow.path,
				"--session-id",
				"default",
				"--cwd",
				workflow.dir,
				"--agent-dir",
				join(workflow.dir, ".plot/agent"),
				"--log-format",
				"json",
				"--log-level",
				"info",
				"--provider",
				"plot-faux",
				"--model",
				"faux-1",
				"--no-tools",
			],
			{
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: {
					...process.env,
					PLOT_FAUX_API_KEY: "plot-faux-key",
					PLOT_FAUX_RESPONSE_TEXT: "hello from spawned faux",
				},
			},
		);
		const stdoutReader = child.stdout.getReader();

		child.stdin.write(
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"req-0","command":"attach_session","params":{"sessionId":"default","role":"controller"}}\n`,
		);
		child.stdin.write(
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"req-1","command":"request_tick","params":{"sessionId":"default"}}\n`,
		);
		const partialStdout = await waitForStdout(stdoutReader, (text) =>
			text.includes("agent_run_event"),
		);
		child.stdin.write(
			`{"protocol":"${plotProtocolVersion}","kind":"request","id":"req-2","command":"close_session","params":{"sessionId":"default"}}\n`,
		);
		child.stdin.end();

		const [stdout, stderr, exitCode] = await Promise.all([
			drainStdout(stdoutReader, partialStdout),
			new Response(child.stderr).text(),
			child.exited,
		]);
		const records = await decodeLines(stdout);
		const eventTypes = records
			.map(eventType)
			.filter((type) => type !== undefined);

		expect(exitCode).toBe(0);
		expect(
			records.every((record) => record.protocol === plotProtocolVersion),
		).toBe(true);
		expect(eventTypes).toContain("agent_run_event");
		expect(stdout).toContain("hello from spawned faux");
		expect(stdout).not.toContain("plot_cli.serve_stdio");
		expect(stderr).toContain("agent_session.create");
		expect(stderr).toContain("agent_session.prompt");
	});
});
