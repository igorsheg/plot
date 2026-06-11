import { defineCommand } from "citty";
import { commonArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { runHumanCommand } from "../io.js";
import { makeAuth, str } from "../options.js";
import { renderModels } from "../render.js";

export const listModelsCommand = defineCommand({
	meta: {
		name: "list-models",
		description: "List models visible to Plot auth.",
	},
	args: {
		search: {
			type: "positional",
			description: "Optional provider/model search text.",
			required: false,
		},
		...commonArgs,
	},
	run: ({ args }) => {
		const io = getCliIo();
		const cwd = str(args, "cwd") ?? process.cwd();
		const search = typeof args.search === "string" ? args.search : args._[0];
		const plotDir = str(args, "plot-dir");
		const agentDir = str(args, "agent-dir");
		return runHumanCommand(
			io,
			makeAuth({
				cwd,
				...(plotDir === undefined ? {} : { plotDir }),
				...(agentDir === undefined ? {} : { agentDir }),
			}).listModels(search),
			(models) => renderModels(search, models),
			"Configure provider auth or pass a valid --cwd/--plot-dir/--agent-dir.",
		);
	},
});
