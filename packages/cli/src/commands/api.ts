import { defineCommand } from "citty";
import { sessionCommandArgs, pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, int, str } from "../options.js";
import { resolvePlotCommand } from "../plot-command.js";
import { runApiStdio } from "../runtime.js";
import { runPlotWebGateway } from "../web-gateway.js";

export const apiCommand = defineCommand({
	meta: {
		name: "api",
		description: "Serve the Plot API for custom clients and frontends.",
	},
	args: {
		...sessionCommandArgs,
		stdio: {
			type: "boolean",
			description: "Serve the run API over newline-delimited JSON on stdio.",
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
		"no-open": {
			type: "boolean",
			description: "Do not open a browser for the HTTP API/dashboard.",
		},
		cwd: pathArgs.cwd,
	},
	run: ({ args }) => {
		const io = getCliIo();
		if (args.stdio === true) {
			io.protectStdout?.();
			return runApiStdio({
				...baseOptions(args),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				stdin: io.stdin,
				writeStdout: io.writeStdout,
			});
		}
		return runPlotWebGateway({
			cwd: str(args, "cwd") ?? process.cwd(),
			...(str(args, "agent-dir") === undefined
				? {}
				: { agentDir: str(args, "agent-dir") }),
			...(str(args, "workflow") === undefined
				? {}
				: { workflowPath: str(args, "workflow") }),
			...(int(args, "port") === undefined ? {} : { port: int(args, "port") }),
			...(str(args, "host") === undefined ? {} : { host: str(args, "host") }),
			open: args["no-open"] !== true,
			cli: resolvePlotCommand(),
			...(io.writeStderr === undefined ? {} : { writeStderr: io.writeStderr }),
		});
	},
});
