import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decodePlotServerRecord } from "@plot/session/protocol";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const tempDirs: string[] = [];

const makeWorkflowFile = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-cli-boundary-"));
	tempDirs.push(dir);
	const path = join(dir, "WORKFLOW.md");
	await writeFile(
		path,
		[
			"---",
			"name: cli-boundary",
			"plot:",
			"  replayCapacity: 8",
			"---",
			"Run the workflow.",
			"",
		].join("\n"),
	);
	return { dir, path };
};

const decodeLines = (text: string) => {
	const lines = text.split("\n").filter((line) => line.length > 0);
	return Effect.all(
		lines.map((line) => decodePlotServerRecord(JSON.parse(line) as unknown)),
	);
};

describe("plot CLI stdio process boundary", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("keeps spawned CLI stdout protocol-only and telemetry on stderr", async () => {
		const workflow = await makeWorkflowFile();
		const process = Bun.spawn(
			[
				"bun",
				fileURLToPath(new URL("../src/main.ts", import.meta.url)),
				"serve",
				"stdio",
				"--workflow",
				workflow.path,
				"--cwd",
				workflow.dir,
				"--log-format",
				"json",
			],
			{
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			},
		);

		process.stdin.write(
			'{"protocol":"plot.v1","kind":"request","id":"req-1","command":"ping"}\n',
		);
		process.stdin.end();

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
			process.exited,
		]);

		expect(exitCode).toBe(0);
		const records = await Effect.runPromise(decodeLines(stdout));
		expect(records.map((record) => record.kind)).toEqual(["hello", "response"]);
		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "hello",
				limits: expect.objectContaining({ maxEventBufferEvents: 8 }),
			}),
		);
		expect(records.every((record) => record.protocol === "plot.v1")).toBe(true);
		expect(stdout).not.toContain("plot_cli.serve_stdio");
		expect(stdout).not.toContain("plot_protocol.submit");
		expect(stderr).toContain("plot_cli.serve_stdio");
		expect(stderr).toContain("plot_protocol.submit");
	});
});
