import { afterEach, describe, expect, test } from "bun:test";
import {
	serverRecordSchema,
	sessionProtocolVersion,
} from "@plot/session/protocol";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runPlotCli } from "../src/cli.js";
import {
	flushRawStdout,
	restoreStdout,
	takeOverStdout,
	writeRawStdout,
} from "../src/stdout-guard.js";

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
		"---\nname: cli-test\nplot:\n  eventBufferCapacity: 7\n---\nRun the workflow.\n",
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

const fakeWrite = (append: (text: string) => void) =>
	((chunk: unknown, ...args: unknown[]) => {
		append(String(chunk));
		const callback = args.find(
			(arg): arg is (error?: Error | null) => void => typeof arg === "function",
		);
		callback?.();
		return true;
	}) as typeof process.stdout.write;

const decodeLines = (lines: readonly string[]) =>
	Promise.all(
		lines.map((line) => serverRecordSchema.parse(JSON.parse(line) as unknown)),
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
		const previousKey = process.env["ANTHROPIC_API_KEY"];
		process.env["ANTHROPIC_API_KEY"] = "anthropic-key";
		const stdout: string[] = [];

		try {
			await runPlotCli(
				[
					"list-models",
					"claude",
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
			if (previousKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
			else process.env["ANTHROPIC_API_KEY"] = previousKey;
		}

		const output = stdout.join("");
		expect(output).toContain("provider");
		expect(output).toContain("model");
		expect(output).toContain("anthropic");
		expect(output).toContain("claude");
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
		expect(output).toContain("Run coding-agent workflows.");
		expect(output).toContain("list-models");
		expect(output).toContain("docs");
		expect(output).not.toContain("dynamic");
		expect(output).toContain("run");
		expect(output).toContain("tui");
		expect(output).toContain("web");
		expect(output).toContain("serve");
		expect(output).not.toContain("stop");
		expect(output).not.toContain("service");
	});

	test("prints root short help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["-h"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("plot [OPTIONS]");
		expect(output).toContain("web");
		expect(output).toContain("serve");
	});

	test("runs the root TUI entrypoint when no subcommand is provided", async () => {
		const workflowPath = await makeWorkflowFile();
		const stdout: string[] = [];
		const calls: unknown[] = [];

		await runPlotCli(
			["--workflow", workflowPath, "--cwd", dirname(workflowPath)],
			{
				stdin: chunks([]),
				writeStdout: (line) => {
					stdout.push(line);
				},
				runTui: (options) => {
					calls.push(options);
				},
			},
		);

		expect(stdout).toEqual([]);
		expect(calls).toEqual([
			expect.objectContaining({
				workflowPath,
				cwd: dirname(workflowPath),
			}),
		]);
	});

	test("prints usage instead of running TUI for an unknown subcommand", async () => {
		const stdout: string[] = [];
		const calls: unknown[] = [];

		await runPlotCli(["wat"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
			runTui: (options) => {
				calls.push(options);
			},
		});

		expect(stdout.join("")).toContain("plot [OPTIONS]");
		expect(calls).toEqual([]);
	});

	test("lets subcommands own their options", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-cli-subcommand-option-"));
		tempDirs.push(dir);
		const previousKey = process.env["ANTHROPIC_API_KEY"];
		process.env["ANTHROPIC_API_KEY"] = "anthropic-key";
		const stdout: string[] = [];

		try {
			await runPlotCli(
				[
					"list-models",
					"claude",
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
			if (previousKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
			else process.env["ANTHROPIC_API_KEY"] = previousKey;
		}

		const output = stdout.join("");
		expect(output).toContain("anthropic");
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
			"Run a workflow once without opening the dashboard.",
		);
		expect(output).toContain("--workflow");
		expect(output).toContain("--provider");
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

	test("prints nested serve stdio help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["serve", "stdio", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain(
			"Serve the Plot session protocol over newline-delimited JSON on stdio.",
		);
		expect(output).toContain("--workflow");
		expect(output).toContain("--tick-interval-ms");
	});

	test("prints fleet instances help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["instances", "events", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Stream instance protocol records.");
		expect(output).toContain("INSTANCEID");
		expect(output).toContain("--after");
	});

	test("stdout guard keeps protocol output on raw stdout", async () => {
		const originalStdout = process.stdout.write;
		const originalStderr = process.stderr.write;
		let stdout = "";
		let stderr = "";
		process.stdout.write = fakeWrite((text) => {
			stdout += text;
		});
		process.stderr.write = fakeWrite((text) => {
			stderr += text;
		}) as typeof process.stderr.write;
		try {
			takeOverStdout();
			await writeRawStdout("protocol\n");
			process.stdout.write("noise\n");
			await flushRawStdout();
		} finally {
			restoreStdout();
			process.stdout.write = originalStdout;
			process.stderr.write = originalStderr;
		}

		expect(stdout).toBe("protocol\n");
		expect(stderr).toBe("noise\n");
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

	test("serves session protocol over stdio with telemetry on stderr", async () => {
		const workflowPath = await makeWorkflowFile();
		const captured = await captureConsole(async () => {
			const stdout: string[] = [];
			await runPlotCli(
				["serve", "stdio", "--workflow", workflowPath, "--log-level", "info"],
				{
					stdin: chunks([
						`{"protocol":"${sessionProtocolVersion}","kind":"request","id":"req-1","command":"ping"}\n`,
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
				limits: expect.objectContaining({ maxBufferedEvents: 7 }),
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
