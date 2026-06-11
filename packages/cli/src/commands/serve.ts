import { defineCommand } from "citty";
import { commonArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions } from "../options.js";
import { serveStdio } from "../runtime.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Serve the plot.v1 protocol for automation.",
	},
	args: {
		transport: {
			type: "positional",
			description: "Transport to serve. Currently only `stdio`.",
			required: false,
		},
		...commonArgs,
	},
	run: ({ args }) => {
		const io = getCliIo();
		const sub = typeof args.transport === "string" ? args.transport : args._[0];
		if (sub !== "stdio") throw new Error("usage: plot serve stdio");
		return serveStdio({
			...baseOptions(args),
			...(io.createAgentSession === undefined
				? {}
				: { createAgentSession: io.createAgentSession }),
			stdin: io.stdin,
			writeStdout: io.writeStdout,
		});
	},
});
