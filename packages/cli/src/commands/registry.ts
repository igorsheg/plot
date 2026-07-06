import { defineCommand } from "citty";
import type { Mutable } from "@plot/common/primitives";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { str } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { runRegistryDaemon, type RunIpcOptions } from "@plot/registry/ipc";

const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Serve the shared Plot run registry daemon.",
	},
	args: {
		cwd: pathArgs.cwd,
		"registry-dir": {
			type: "string",
			description: "Run registry state directory.",
			valueHint: "path",
		},
	},
	run: ({ args }) => {
		const io = getCliIo();
		const runRegistryDir = str(args, "registry-dir");
		const options: Mutable<RunIpcOptions> = {
			cwd: str(args, "cwd") ?? process.cwd(),
			cli: resolvePlotCommand(),
		};
		if (runRegistryDir !== undefined) options.runRegistryDir = runRegistryDir;
		return runRegistryDaemon(options, {
			onReady: (socketPath) =>
				writeCliStderr(io, `Plot run registry: ${socketPath}\n`),
		});
	},
});

export const registryCommand = defineCommand({
	meta: {
		name: "registry",
		description: "Manage the shared Plot run registry daemon.",
	},
	subCommands: {
		serve: serveCommand,
	},
});
