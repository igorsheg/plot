import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions } from "../options.js";
import { serveFleet, serveStdio } from "../runtime.js";
import { cliSemantics } from "../semantics.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: cliSemantics.serve.description,
	},
	subCommands: {
		stdio: defineCommand({
			meta: {
				name: "stdio",
				description: cliSemantics.stdio.description,
			},
			args: sessionCommandArgs,
			run: ({ args }) => {
				const io = getCliIo();
				io.protectStdout?.();
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
		fleet: defineCommand({
			meta: {
				name: "fleet",
				description: "Run the local Plot fleet daemon.",
			},
			args: sessionCommandArgs,
			run: ({ args }) => {
				const io = getCliIo();
				return serveFleet({
					...baseOptions(args),
					...(io.writeStderr === undefined
						? {}
						: { writeStderr: io.writeStderr }),
				});
			},
		}),
	},
});
