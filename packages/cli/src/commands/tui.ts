import { runPlotTui } from "@plot/tui/plot-tui";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, bool } from "../options.js";

export const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description:
			"Attach the terminal dashboard to a Local Plot Server session.",
	},
	args: {
		...sessionCommandArgs,
		"no-server": {
			type: "boolean",
			description:
				"Explicit escape hatch: run an in-process TUI instead of the Local Plot Server.",
		},
	},
	run: ({ args, rawArgs }) => {
		const io = getCliIo();
		const noServer = bool(args, "no-server") || rawArgs.includes("--no-server");
		return runPlotTui({
			...baseOptions(args),
			...(noServer ? { noServer: true } : {}),
			...(io.createAgentSession === undefined
				? {}
				: { createAgentSession: io.createAgentSession }),
		});
	},
});
