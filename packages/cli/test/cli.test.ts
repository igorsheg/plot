import { afterEach, describe, expect, test } from "bun:test";
import {
	decodePlotServerRecord,
	plotProtocolVersion,
} from "@plot/session/protocol";
import { writePlotFauxAgentFiles } from "@plot/session/testing/faux-agent-session";
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
	await writeFile(
		path,
		"---\nname: cli-test\nplot:\n  replayCapacity: 7\n---\nRun the workflow.\n",
	);
	return path;
};

const captureConsole = async (run: () => Promise<string[]>) => {
	const runtimeConsole = Reflect.get(globalThis, "console") as Console;
	const originalError = runtimeConsole.error;
	const originalWarn = runtimeConsole.warn;
	const originalWrite = process.stderr.write;
	let stderr = "";
	runtimeConsole.error = (...args: readonly unknown[]) => {
		stderr += `${args.map(String).join(" ")}\n`;
	};
	process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
		stderr += String(chunk);
		const callback = args.find(
			(arg): arg is (error?: Error | null) => void => typeof arg === "function",
		);
		callback?.();
		return true;
	}) as typeof process.stderr.write;
	runtimeConsole.warn = runtimeConsole.error;
	try {
		const stdout = await run();
		return { stdout, stderr };
	} finally {
		runtimeConsole.error = originalError;
		runtimeConsole.warn = originalWarn;
		process.stderr.write = originalWrite;
	}
};

const decodeLines = (lines: readonly string[]) =>
	Promise.all(
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

	test("prints model list as a text table", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-cli-models-"));
		tempDirs.push(dir);
		await writePlotFauxAgentFiles({ cwd: dir });
		const previousKey = process.env["PLOT_FAUX_API_KEY"];
		process.env["PLOT_FAUX_API_KEY"] = "plot-faux-key";
		const stdout: string[] = [];

		try {
			await runPlotCli(
				[
					"list-models",
					"faux",
					"--cwd",
					dir,
					"--agent-dir",
					join(dir, ".plot/agent"),
				],
				{
					stdin: chunks([]),
					writeStdout: (line) => {
						stdout.push(line);
					},
				},
			);
		} finally {
			if (previousKey === undefined) delete process.env["PLOT_FAUX_API_KEY"];
			else process.env["PLOT_FAUX_API_KEY"] = previousKey;
		}

		const output = stdout.join("");
		expect(output).toContain("provider");
		expect(output).toContain("model");
		expect(output).toContain("plot-faux");
		expect(output).toContain("faux-1");
	});

	test("prints citty root help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("A control plane for long-running coding agents.");
		expect(output).toContain("list-models");
		expect(output).toContain("docs");
		expect(output).toContain("run");
		expect(output).toContain("tui");
		expect(output).toContain("web");
		expect(output).toContain("stop");
		expect(output).not.toContain("service");
		expect(output).not.toContain("_serve");
	});

	test("prints root short help without internal commands", async () => {
		const stdout: string[] = [];
		await runPlotCli(["-h"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("plot [OPTIONS]");
		expect(output).not.toContain("_serve");
	});

	test("allows root options before a subcommand", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-cli-global-option-"));
		tempDirs.push(dir);
		await writePlotFauxAgentFiles({ cwd: dir });
		const previousKey = process.env["PLOT_FAUX_API_KEY"];
		process.env["PLOT_FAUX_API_KEY"] = "plot-faux-key";
		const stdout: string[] = [];

		try {
			await runPlotCli(
				[
					"--cwd",
					dir,
					"--agent-dir",
					join(dir, ".plot/agent"),
					"list-models",
					"faux",
				],
				{
					stdin: chunks([]),
					writeStdout: (line) => {
						stdout.push(line);
					},
				},
			);
		} finally {
			if (previousKey === undefined) delete process.env["PLOT_FAUX_API_KEY"];
			else process.env["PLOT_FAUX_API_KEY"] = previousKey;
		}

		const output = stdout.join("");
		expect(output).toContain("plot-faux");
	});

	test("prints citty subcommand help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["run", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain(
			"Run a workflow once through the Local Plot Server without opening the dashboard.",
		);
		expect(output).toContain("--workflow");
		expect(output).toContain("--provider");
	});

	test("prints web command help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["web", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain(
			"Open the web dashboard against the shared Local Plot Server.",
		);
		expect(output).toContain("--no-open");
		expect(output).toContain("--session-id");
		expect(output).not.toContain("--workflow");
	});

	test("prints nested citty auth help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["auth", "login", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Start an interactive provider login.");
		expect(output).toContain("PROVIDERNAME");
		expect(output).toContain("--agent-dir");
		expect(output).not.toContain("--tick-interval-ms");
	});

	test("prints nested citty internal serve help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["_serve", "stdio", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain(
			"Serve Plot control protocol over newline-delimited JSON on stdio.",
		);
		expect(output).toContain("--workflow");
		expect(output).toContain("--tick-interval-ms");
	});

	test("list-models help only exposes auth path options", async () => {
		const stdout: string[] = [];
		await runPlotCli(["list-models", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Optional provider/model search text.");
		expect(output).toContain("--agent-dir");
		expect(output).not.toContain("--tick-interval-ms");
		expect(output).not.toContain("--workflow");
	});

	test("prints bundled extension author docs", async () => {
		const stdout: string[] = [];
		await runPlotCli(["docs", "extension-prompt"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("plot-ai/sdk");
		expect(output).toContain("definePlotExtension");
		expect(output).toContain("Do not import Plot internals");
	});

	test("serves explicit control protocol over stdio with telemetry on stderr", async () => {
		const workflowPath = await makeWorkflowFile();
		const captured = await captureConsole(async () => {
			const stdout: string[] = [];
			await runPlotCli(
				[
					"_serve",
					"stdio",
					"--workflow",
					workflowPath,
					"--log-format",
					"json",
					"--log-level",
					"info",
				],
				{
					stdin: chunks([
						`{"protocol":"${plotProtocolVersion}","kind":"request","id":"req-1","command":"ping"}\n`,
					]),
					writeStdout: (line) => {
						stdout.push(line);
					},
				},
			);
			return stdout;
		});

		const records = await decodeLines(captured.stdout);
		expect(records.map((record) => record.kind)).toContain("welcome");
		expect(records.map((record) => record.kind)).toContain("response");
		expect(records[0]).toEqual(
			expect.objectContaining({
				kind: "welcome",
				limits: expect.objectContaining({ maxEventBufferEvents: 7 }),
			}),
		);
		expect(records.find((record) => record.kind === "response")).toEqual(
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
