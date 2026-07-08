import { defineCommand } from "citty";
import type { Mutable } from "@plot/common/primitives";
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
			const stdioOptions = baseOptions(args) as Mutable<ApiStdioOptions>;
			if (io.createAgentSession !== undefined)
				stdioOptions.createAgentSession = io.createAgentSession;
			stdioOptions.stdin = io.stdin;
			stdioOptions.writeLine = io.writeStdout;
			return runApiStdio(stdioOptions);
		}
		const options: Mutable<Parameters<typeof runPlotWebGateway>[0]> = {
			cwd: str(args, "cwd") ?? process.cwd(),
			open: args["open"] === true,
			openUrl: openBrowser,
			cli: resolvePlotCommand(),
		};
		const agentDir = str(args, "agent-dir");
		const workflowPath = workflowPathFromArgs(args);
		const port = int(args, "port");
		const host = str(args, "host");
		if (agentDir !== undefined) options.agentDir = agentDir;
		if (workflowPath !== undefined) options.workflowPath = workflowPath;
		if (port !== undefined) options.port = port;
		if (host !== undefined) options.host = host;
		if (io.writeStderr !== undefined) options.writeStderr = io.writeStderr;
		return runPlotWebGateway(options);
	},
});
