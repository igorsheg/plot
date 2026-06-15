import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, int, str } from "../options.js";
import { serveLocal, serveStdio } from "../runtime.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Run the localhost Local Plot Server until Ctrl-C.",
	},
	args: {
		hostname: {
			type: "string",
			description: "Listen hostname. Default: localhost.",
			valueHint: "host",
		},
		port: {
			type: "string",
			description:
				"Listen port. Default prefers the stable local Plot port; 0 uses an ephemeral port.",
			valueHint: "port",
		},
		...sessionCommandArgs,
	},
	run: ({ args, rawArgs }) => {
		const io = getCliIo();
		if (rawArgs.some((arg) => arg === "stdio")) return undefined;
		return serveLocal({
			...baseOptions(args),
			...(str(args, "hostname") === undefined
				? {}
				: { hostname: str(args, "hostname")! }),
			...(int(args, "port") === undefined ? {} : { port: int(args, "port")! }),
			writeStdout: io.writeStdout,
		});
	},
	subCommands: {
		stdio: defineCommand({
			meta: {
				name: "stdio",
				description:
					"Serve Plot control protocol over newline-delimited JSON on stdio.",
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
