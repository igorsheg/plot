import { runPlotTui } from "@plot/tui/plot-tui";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions } from "../options.js";

export const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description: "Open the terminal dashboard for a workflow.",
	},
	args: sessionCommandArgs,
	run: ({ args }) => {
		const io = getCliIo();
		return runPlotTui({
			...baseOptions(args),
			...(io.createAgentSession === undefined
				? {}
				: { createAgentSession: io.createAgentSession }),
		});
	},
});
