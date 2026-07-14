#!/usr/bin/env bun
import { createWriteStream } from "node:fs";
import { runPlotCli } from "./cli.js";
import { serveSessionWorker } from "@plot/session/worker";
import { runSessionManagerDaemon } from "@plot/session-manager/ipc";
import { plotProcessIdentity, resolvePlotCommand } from "./plot-command.js";

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
		const protocol = createWriteStream("plot-worker-protocol", {
			fd: 3,
			autoClose: false,
		});
		return serveSessionWorker({
			cwd,
			sessionId,
			workflowPath,
			stdin: process.stdin,
			writeLine: (line) =>
				new Promise<void>((resolve, reject) => {
					protocol.write(line, (error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
		}).finally(() => protocol.end());
	}
	if (args[0] === "__internal-session-manager") {
		const managerDir = valueAfter("--manager-dir");
		const cli = resolvePlotCommand();
		const identity = plotProcessIdentity(cli);
		return runSessionManagerDaemon(
			managerDir === undefined
				? { cli, identity }
				: { cli, identity, managerDir },
		);
	}
	return undefined;
};

const internal = runInternal();
if (internal === undefined) {
	void runPlotCli(args).then((code) => {
		process.exitCode = code;
		return undefined;
	});
} else {
	void internal.catch((error) => {
		if (error === null || error === undefined) return;
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	});
}
