import { defineCommand } from "citty";
import { sessionCommandArgs, pathArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { openBrowser } from "../io.js";
import { baseOptions, int, str, workflowPathFromArgs } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { runApiStdio, type ApiStdioOptions } from "../runtime.js";
import { runPlotWebGateway } from "@plot/gateway";

export const serveApiCommand = defineCommand({
	meta: {
		name: "api",
		description: "Serve the Plot API for custom clients and frontends.",
	},
	args: {
		...workflowPathArg,
		...sessionCommandArgs,
		stdio: {
			type: "boolean",
			description:
				"Serve the session protocol over newline-delimited JSON on stdio.",
		},
		http: {
			type: "boolean",
			description:
				"Serve the run API over HTTP. Default when --stdio is omitted.",
		},
		port: {
			type: "string",
			description: "HTTP API port. Default: random free port.",
			valueHint: "port",
		},
		host: {
			type: "string",
			description: "HTTP API host. Default: 127.0.0.1.",
			valueHint: "host",
		},
		open: {
			type: "boolean",
			description: "Open the HTTP API/dashboard in a browser.",
		},
		cwd: pathArgs.cwd,
	},
	run: ({ args }) => {
		const io = getCliIo();
		if (args.stdio === true) {
			io.protectStdout?.();
			return runApiStdio({
				...baseOptions(args),
				createAgentSession: io.createAgentSession,
				stdin: io.stdin,
				writeLine: io.writeStdout,
			} as ApiStdioOptions);
		}
		return runPlotWebGateway({
			cwd: str(args, "cwd") ?? process.cwd(),
			open: args["open"] === true,
			openUrl: openBrowser,
			cli: resolvePlotCommand(),
			agentDir: str(args, "agent-dir"),
			workflowPath: workflowPathFromArgs(args),
			port: int(args, "port"),
			host: str(args, "host"),
			writeStderr: io.writeStderr,
		} as Parameters<typeof runPlotWebGateway>[0]);
	},
});
