import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions } from "../options.js";
import { serveStdio } from "../runtime.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Serve the plot.v1 protocol for automation.",
	},
	subCommands: {
		stdio: defineCommand({
			meta: {
				name: "stdio",
				description: "Serve plot.v1 over newline-delimited JSON on stdio.",
			},
			args: sessionCommandArgs,
			run: ({ args }) => {
				const io = getCliIo();
				return serveStdio({
					...baseOptions(args),
					...(io.createAgentSession === undefined
						? {}
						: { createAgentSession: io.createAgentSession }),
					stdin: io.stdin,
					writeStdout: io.writeStdout,
				});
			},
		}),
	},
});
