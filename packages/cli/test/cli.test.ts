import { afterEach, describe, expect, test } from "bun:test";
import {
	decodeServerRecord,
	sessionProtocolVersion,
} from "@plot/session/protocol";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runPlotCli } from "../src/cli.js";
import { selectOptionId } from "../src/commands/auth.js";
import { resolveRunIdPrefix } from "../src/commands/runs.js";
import { renderModels, renderRunEvent } from "../src/render.js";
import { renderWebDashboardReady } from "../src/terminal.js";
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
		lines.map((line) => decodeServerRecord(JSON.parse(line) as unknown)),
	);

describe("plot CLI", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("prints rounded fractional token counts in model table", () => {
		const output = renderModels(undefined, [
			{
				provider: "test",
				model: "fractional-model",
				context: 32_768,
				maxOutput: 1_048_576,
				thinking: false,
				images: false,
			},
		]);

		expect(output).toContain("32.8K");
		expect(output).toContain("1.0M");
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
					"models",
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
		expect(output).toContain("models");
		expect(output).toContain("docs");
		expect(output).not.toContain("dynamic");
		expect(output).toContain("open");
		expect(output).toContain("run");
		expect(output).toContain("runs");
		expect(output).toContain("auth");
		expect(output).toContain("init");
		expect(output).toContain("doctor");
		expect(output).not.toContain("plot tui");
		expect(output).not.toContain("plot web");
		expect(output).not.toContain("plot api");
		expect(output).not.toContain("plot ls");
		expect(output).toContain("plot docs cli");
		expect(output).not.toContain("--request-queue-capacity");
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
		expect(output).toContain("plot open [workflow]");
		expect(output).toContain("plot runs");
		expect(output).toContain("plot docs cli");
	});

	test("supports help subcommand routing", async () => {
		const stdout: string[] = [];
		await runPlotCli(["help", "auth", "login"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Start an interactive provider login.");
		expect(output).toContain("[PROVIDERNAME]");
	});

	test("old command names show a suggestion", async () => {
		const stdout: string[] = [];
		await runPlotCli(["list-models"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Unknown command: list-models");
		expect(output).toContain("Did you mean: plot models");
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

	test("open accepts a positional workflow path", async () => {
		const workflowPath = await makeWorkflowFile();
		const calls: unknown[] = [];

		await runPlotCli(["open", workflowPath, "--cwd", dirname(workflowPath)], {
			stdin: chunks([]),
			writeStdout: () => {},
			runTui: (options) => {
				calls.push(options);
			},
		});

		expect(calls).toEqual([
			expect.objectContaining({
				workflowPath,
				cwd: dirname(workflowPath),
			}),
		]);
	});

	test("init creates a starter workflow", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-cli-init-"));
		tempDirs.push(dir);
		const stdout: string[] = [];

		await runPlotCli(["init", "WORKFLOW.md", "--cwd", dir], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		expect(stdout.join("")).toContain("Created");
		expect(await readFile(join(dir, "WORKFLOW.md"), "utf8")).toContain(
			"name: default",
		);
	});

	test("config set and get write project settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-cli-config-"));
		tempDirs.push(dir);
		const stdout: string[] = [];

		await runPlotCli(
			["config", "set", "defaultProvider", "anthropic", "--cwd", dir],
			{
				stdin: chunks([]),
				writeStdout: (line) => {
					stdout.push(line);
				},
			},
		);
		await runPlotCli(["config", "get", "defaultProvider", "--cwd", dir], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		expect(stdout.join("")).toContain("Set defaultProvider");
		expect(stdout.at(-1)).toBe("anthropic\n");
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

		expect(stdout.join("")).toContain("plot open [workflow]");
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
					"models",
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

	test("open web help documents explicit browser opening", async () => {
		const stdout: string[] = [];
		await runPlotCli(["open", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("--web");
		expect(output).toContain("--open");
		expect(output).not.toContain("--no-open");
	});

	test("web dashboard landing screen is compact and branded", () => {
		const output = renderWebDashboardReady("http://127.0.0.1:1234/", {
			color: false,
		});

		expect(output).toContain("░█▀█░█░░░█▀█░▀█▀");
		expect(output).toContain("Running at http://127.0.0.1:1234/");
		expect(output).toContain("o open browser • q stop • Ctrl-C stop");
	});

	test("auth select accepts labels, ids, numbers, and default", () => {
		const prompt = {
			message: "Select OpenAI Codex login method:",
			options: [
				{ id: "browser", label: "Browser login (default)" },
				{ id: "device", label: "Device code login (headless)" },
			],
		};

		expect(selectOptionId(prompt, "")).toBe("browser");
		expect(selectOptionId(prompt, "2")).toBe("device");
		expect(selectOptionId(prompt, "device")).toBe("device");
		expect(selectOptionId(prompt, "Browser login")).toBe("browser");
	});

	test("run id prefixes resolve when they are unique", () => {
		const runs = [
			{ id: "76e84f20-ca5e-4061-8e66-d8dab84950d4" },
			{ id: "aaaaaaaa-0000-0000-0000-000000000000" },
		];

		expect(resolveRunIdPrefix("76e84f20", runs)).toBe(runs[0]!.id);
		expect(() => resolveRunIdPrefix("missing", runs)).toThrow("Run not found");
		expect(() =>
			resolveRunIdPrefix("a", [
				{ id: "aaaaaaaa-0000-0000-0000-000000000000" },
				{ id: "aaaaaaab-0000-0000-0000-000000000000" },
			]),
		).toThrow("ambiguous");
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

	test("prints API stdio help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["serve", "api", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Serve the Plot API");
		expect(output).toContain("--stdio");
		expect(output).toContain("--workflow");
	});

	test("prints run logs help", async () => {
		const stdout: string[] = [];
		await runPlotCli(["runs", "logs", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("Stream run protocol records.");
		expect(output).toContain("RUNID");
		expect(output).toContain("--after");
		expect(output).toContain("--registry-dir");
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

	test("models help only exposes auth path options", async () => {
		const stdout: string[] = [];
		await runPlotCli(["models", "--help"], {
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

	test("prints web docs", async () => {
		const stdout: string[] = [];
		await runPlotCli(["docs", "web"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("# Web Dashboard");
		expect(output).toContain("plot open --web");
	});

	test("prints CLI docs", async () => {
		const stdout: string[] = [];
		await runPlotCli(["docs", "cli"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});

		const output = stdout.join("");
		expect(output).toContain("# CLI");
		expect(output).toContain("plot runs show <run-id>");
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

	test("run output renders only the last assistant message content", () => {
		expect(
			renderRunEvent({
				kind: "agent_event",
				event: {
					type: "agent_end",
					messages: [
						{ role: "assistant", content: "old" },
						{ role: "assistant", content: [{ type: "text", text: "done" }] },
					],
				},
			} as never),
		).toBe("\nFinal assistant message:\ndone\n\nInner agent finished.\n");
	});

	test("serves session protocol over API stdio with telemetry on stderr", async () => {
		const workflowPath = await makeWorkflowFile();
		const captured = await captureConsole(async () => {
			const stdout: string[] = [];
			await runPlotCli(
				[
					"serve",
					"api",
					"--stdio",
					"--workflow",
					workflowPath,
					"--log-level",
					"info",
				],
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
		expect(captured.stdout.join("")).not.toContain("plot_cli.api_stdio");
		expect(captured.stderr).toContain("plot_cli.api_stdio");
	});
});
