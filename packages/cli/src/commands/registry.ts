import { existsSync, unlinkSync } from "node:fs";
import { defineCommand } from "citty";
import type { Mutable } from "@plot/common/primitives";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { str } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { startRunIpcServer } from "@plot/registry/ipc";

const serveRegistry = async (input: {
	readonly cwd: string;
	readonly runRegistryDir?: string;
	readonly writeStderr?: (text: string) => Promise<void> | void;
}) => {
	const options: Mutable<Parameters<typeof startRunIpcServer>[0]["options"]> = {
		cwd: input.cwd,
		cli: resolvePlotCommand(),
	};
	if (input.runRegistryDir !== undefined)
		options.runRegistryDir = input.runRegistryDir;
	const server = await startRunIpcServer({ options });
	await input.writeStderr?.(`Plot run registry: ${server.socketPath}\n`);
	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		server.server.close();
		await server.runRegistry.shutdown();
		if (existsSync(server.socketPath)) unlinkSync(server.socketPath);
	};
	process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
	await new Promise<void>(() => {});
};

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
		const input: Mutable<Parameters<typeof serveRegistry>[0]> = {
			cwd: str(args, "cwd") ?? process.cwd(),
		};
		if (runRegistryDir !== undefined) input.runRegistryDir = runRegistryDir;
		if (io.writeStderr !== undefined) input.writeStderr = io.writeStderr;
		return serveRegistry(input);
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
