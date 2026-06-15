import { defineCommand } from "citty";
import { pathArgs, workflowArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { baseOptions, bool } from "../options.js";
import { stopLocalService, stopProjectSession } from "../runtime.js";

export const stopCommand = defineCommand({
	meta: {
		name: "stop",
		description: "Close this project session, or stop all Plot sessions.",
	},
	args: {
		workflow: workflowArgs.workflow,
		"session-id": workflowArgs["session-id"],
		cwd: pathArgs.cwd,
		all: {
			type: "boolean",
			description: "Stop the daemon and all hosted sessions.",
		},
	},
	run: ({ args, rawArgs }) => {
		const io = getCliIo();
		if (bool(args, "all") || rawArgs.includes("--all"))
			return stopLocalService({ writeStdout: io.writeStdout });
		return stopProjectSession({
			...baseOptions(args),
			writeStdout: io.writeStdout,
		});
	},
});
