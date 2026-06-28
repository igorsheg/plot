import { defineCommand } from "citty";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { int, str } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { cliSemantics } from "../semantics.js";
import { runPlotWebGateway } from "../web-gateway.js";

export const webCommand = defineCommand({
	meta: {
		name: "web",
		description: cliSemantics.web.description,
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
		return runPlotWebGateway({
			cwd: str(args, "cwd") ?? process.cwd(),
			...(str(args, "agent-dir") === undefined
				? {}
				: { agentDir: str(args, "agent-dir") }),
			...(int(args, "port") === undefined ? {} : { port: int(args, "port") }),
			open: args["no-open"] !== true,
			cli: resolvePlotCommand(),
			...(io.writeStderr === undefined ? {} : { writeStderr: io.writeStderr }),
		});
	},
});
