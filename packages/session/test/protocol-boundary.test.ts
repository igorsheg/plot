import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { LoggerLive } from "@plot/common/observability";
import type { WorkRunner } from "@plot/agent/work-runner";
import { makePlotSessionLayer } from "../src/plot-session.js";
import { decodePlotServerRecord } from "../src/protocol.js";
import { makePlotProtocolLayer } from "../src/protocol-handler.js";
import { runPlotProtocolStdio } from "../src/protocol-stdio.js";
import type { WorkflowDefinition } from "../src/workflow.js";

const workflow: WorkflowDefinition = {
	config: {},
	prompt: "Do useful work.",
};

const runner: WorkRunner = {
	run: () => Effect.succeed({}),
};

async function* stdin() {
	yield '{"protocol":"plot.v1","kind":"request","id":"req-1","command":"ping"}\n';
}

const protocolLayer = makePlotProtocolLayer().pipe(
	Layer.provide(makePlotSessionLayer({ workflow, sources: [], runner })),
);

const captureProcessWrites = async (run: () => Promise<void>) => {
	const runtimeConsole = Reflect.get(globalThis, "console") as Console;
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;
	const originalConsoleLog = runtimeConsole.log;
	const originalConsoleInfo = runtimeConsole.info;
	const originalConsoleError = runtimeConsole.error;
	const originalConsoleWarn = runtimeConsole.warn;
	let stdout = "";
	let stderr = "";

	process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
		stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
		const callback = args.find((arg) => typeof arg === "function");
		if (typeof callback === "function") callback();
		return true;
	}) as typeof process.stdout.write;

	process.stderr.write = ((chunk: unknown, ...args: unknown[]) => {
		stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
		const callback = args.find((arg) => typeof arg === "function");
		if (typeof callback === "function") callback();
		return true;
	}) as typeof process.stderr.write;

	runtimeConsole.log = (...args: readonly unknown[]) => {
		stdout += `${args.map(String).join(" ")}\n`;
	};
	runtimeConsole.info = runtimeConsole.log;
	runtimeConsole.error = (...args: readonly unknown[]) => {
		stderr += `${args.map(String).join(" ")}\n`;
	};
	runtimeConsole.warn = runtimeConsole.error;

	try {
		await run();
		return { stdout, stderr };
	} finally {
		process.stdout.write = originalStdoutWrite;
		process.stderr.write = originalStderrWrite;
		runtimeConsole.log = originalConsoleLog;
		runtimeConsole.info = originalConsoleInfo;
		runtimeConsole.error = originalConsoleError;
		runtimeConsole.warn = originalConsoleWarn;
	}
};

describe("stdio protocol boundary", () => {
	test("keeps stdout protocol-only while telemetry goes to stderr", async () => {
		const captured = await captureProcessWrites(async () => {
			await Effect.runPromise(
				runPlotProtocolStdio({
					stdin: stdin(),
					writeStdout: (line) =>
						Effect.sync(() => {
							process.stdout.write(line);
						}),
				}).pipe(
					Effect.provide(
						Layer.mergeAll(protocolLayer, LoggerLive({ stderr: true })),
					),
				),
			);
		});

		const stdoutLines = captured.stdout
			.split("\n")
			.filter((line) => line.length > 0);
		const stdoutRecords = await Effect.runPromise(
			Effect.all(
				stdoutLines.map((line) =>
					decodePlotServerRecord(JSON.parse(line) as unknown),
				),
			),
		);

		expect(stdoutRecords.map((record) => record.kind)).toEqual([
			"hello",
			"response",
		]);
		expect(captured.stdout).not.toContain("plot_protocol.hello");
		expect(captured.stdout).not.toContain("plot_protocol.submit");
		expect(captured.stderr).toContain("plot_protocol.hello");
		expect(captured.stderr).toContain("plot_protocol.submit");
	});
});
