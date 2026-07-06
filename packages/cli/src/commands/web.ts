import { defineCommand } from "citty";
import type { Mutable } from "@plot/common/primitives";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { openBrowser } from "../io.js";
import { int, str } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { runPlotWebGateway } from "@plot/gateway";

export const webCommand = defineCommand({
	meta: {
		name: "web",
		description: "Open the local Plot canvas for running sessions.",
	},
	args: {
		cwd: pathArgs.cwd,
		"agent-dir": pathArgs["agent-dir"],
		port: {
			type: "string",
			description: "Local web port. Default: random free port.",
			valueHint: "port",
		},
		"no-open": {
			type: "boolean",
			description: "Print the URL without opening a browser.",
		},
	},
	run: ({ args }) => {
		const io = getCliIo();
		const options: Mutable<Parameters<typeof runPlotWebGateway>[0]> = {
			cwd: str(args, "cwd") ?? process.cwd(),
			open: args["no-open"] !== true,
			openUrl: openBrowser,
			cli: resolvePlotCommand(),
		};
		const agentDir = str(args, "agent-dir");
		const port = int(args, "port");
		if (agentDir !== undefined) options.agentDir = agentDir;
		if (port !== undefined) options.port = port;
		if (io.writeStderr !== undefined) options.writeStderr = io.writeStderr;
		return runPlotWebGateway(options);
	},
});
