import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BunServices } from "@effect/platform-bun";
import { decodePlotServerRecord } from "@plot/session/protocol";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPlotCli } from "../src/cli.js";

const tempDirs: string[] = [];

async function* chunks(values: readonly string[]) {
	for (const value of values) yield value;
}

const makeWorkflowFile = async () => {
	const dir = await mkdtemp(join(tmpdir(), "plot-cli-"));
	tempDirs.push(dir);
	const path = join(dir, "WORKFLOW.md");
	await writeFile(path, "---\nname: cli-test\n---\nRun the workflow.\n");
	return path;
};

const captureConsole = async (run: () => Promise<string[]>) => {
	const runtimeConsole = Reflect.get(globalThis, "console") as Console;
	const originalError = runtimeConsole.error;
	const originalWarn = runtimeConsole.warn;
	let stderr = "";
	runtimeConsole.error = (...args: readonly unknown[]) => {
		stderr += `${args.map(String).join(" ")}\n`;
	};
	runtimeConsole.warn = runtimeConsole.error;
	try {
		const stdout = await run();
		return { stdout, stderr };
	} finally {
		runtimeConsole.error = originalError;
		runtimeConsole.warn = originalWarn;
	}
};

const decodeLines = (lines: readonly string[]) =>
	Effect.all(
		lines.map((line) => decodePlotServerRecord(JSON.parse(line) as unknown)),
	);

describe("plot CLI", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("serves plot.v1 over stdio with telemetry on stderr", async () => {
		const workflowPath = await makeWorkflowFile();
		const captured = await captureConsole(async () => {
			const stdout: string[] = [];
			await Effect.runPromise(
				runPlotCli(
					[
						"serve",
						"stdio",
						"--workflow",
						workflowPath,
						"--log-format",
						"json",
					],
					{
						stdin: chunks([
							'{"protocol":"plot.v1","kind":"request","id":"req-1","command":"ping"}\n',
						]),
						writeStdout: (line) => Effect.sync(() => stdout.push(line)),
					},
				).pipe(Effect.provide(BunServices.layer)),
			);
			return stdout;
		});

		const records = await Effect.runPromise(decodeLines(captured.stdout));
		expect(records.map((record) => record.kind)).toEqual(["hello", "response"]);
		expect(records[1]).toEqual(
			expect.objectContaining({
				kind: "response",
				id: "req-1",
				command: "ping",
				ok: true,
			}),
		);
		expect(captured.stdout.join("")).not.toContain("plot_cli.serve_stdio");
		expect(captured.stderr).toContain("plot_cli.serve_stdio");
	});
});
