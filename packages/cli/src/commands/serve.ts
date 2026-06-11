import { defineCommand } from "citty";
import { commonArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions } from "../options.js";
import { serveStdio } from "../runtime.js";

export const serveCommand = defineCommand({
	meta: { name: "serve", description: "Serve Plot protocol" },
	args: commonArgs,
	run: ({ args }) => {
		const io = getCliIo();
		const [sub] = args._;
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
