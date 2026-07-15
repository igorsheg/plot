#!/usr/bin/env bun
import { errorMessage } from "@plot/common/primitives";
import { serveSessionWorker } from "@plot/session/worker";
import { runSessionManagerDaemon } from "@plot/session-manager/ipc";
import { runPlotCli } from "./cli.js";
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
		return serveSessionWorker({ cwd, sessionId, workflowPath }).finally(() => {
			process.disconnect?.();
		});
	}
	if (args[0] !== "__internal-session-manager") return;
	const managerDir = valueAfter("--manager-dir");
	const cli = resolvePlotCommand();
	const identity = plotProcessIdentity(cli);
	if (managerDir === undefined)
		return runSessionManagerDaemon({ cli, identity });
	return runSessionManagerDaemon({ cli, identity, managerDir });
};

const main = async (): Promise<void> => {
	const internal = runInternal();
	if (internal !== undefined) await internal;
	else process.exitCode = await runPlotCli(args);
};

void main().catch((error) => {
	process.stderr.write(`${errorMessage(error)}\n`);
	process.exitCode = 1;
});
