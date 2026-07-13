#!/usr/bin/env bun
import { runPlotCli } from "./cli.js";
import { serveSessionWorker } from "@plot/session/worker";
import { runSessionManagerDaemon } from "@plot/session-manager/ipc";
import { resolvePlotCommand } from "./plot-command.js";

const args = process.argv.slice(2);

const valueAfter = (name: string): string | undefined => {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
};

const runInternal = (): Promise<void> | undefined => {
	if (args[0] === "__internal-session-worker") {
		const cwd = valueAfter("--cwd");
		const sessionId = valueAfter("--session-id");
		const workflowPath = valueAfter("--workflow");
		if (
			cwd === undefined ||
			sessionId === undefined ||
			workflowPath === undefined
		)
			throw new Error("invalid Session worker invocation");
		return serveSessionWorker({
			cwd,
			sessionId,
			workflowPath,
			stdin: process.stdin,
			writeLine: (line) =>
				new Promise<void>((resolve, reject) => {
					process.stdout.write(line, (error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
		});
	}
	if (args[0] === "__internal-session-manager") {
		const managerDir = valueAfter("--manager-dir");
		return runSessionManagerDaemon(
			managerDir === undefined
				? { cli: resolvePlotCommand() }
				: { cli: resolvePlotCommand(), managerDir },
		);
	}
	return undefined;
};

const run = runInternal() ?? runPlotCli(args);
run.catch((error) => {
	if (error === null || error === undefined) return;
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
});
