import { runPlotTui } from "@plot/tui/plot-tui";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, bool } from "../options.js";

export const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description:
			"Open the terminal dashboard. Attaches to a running Local Plot Server (e.g. started by `plot web`); otherwise runs an in-process session. Never starts its own server.",
	},
	args: {
		...sessionCommandArgs,
		"no-server": {
			type: "boolean",
			description:
				"Always run an in-process session, even if a Local Plot Server is running.",
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
