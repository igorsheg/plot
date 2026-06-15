import { runPlotTui } from "@plot/tui/plot-tui";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, bool } from "../options.js";

export const tuiCommand = defineCommand({
	meta: {
		name: "tui",
		description:
			"Open the terminal dashboard. Attaches to the shared Local Plot Server, starting it if none is running — so multiple TUIs and `plot web` share one fleet.",
	},
	args: {
		...sessionCommandArgs,
		"no-server": {
			type: "boolean",
			description:
				"Run a private in-process session instead of the shared Local Plot Server.",
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
