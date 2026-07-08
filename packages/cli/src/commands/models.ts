import { defineCommand } from "citty";
import { authPathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { runHumanCommand } from "../io.js";
import { makeAuthFromArgs } from "../options.js";
import { renderModels } from "../render.js";

export const modelsCommand = defineCommand({
	meta: {
		name: "models",
		description: "List provider models visible to Plot auth.",
	},
	args: {
		search: {
			type: "positional",
			description: "Optional provider/model search text.",
			required: false,
		},
		...authPathArgs,
	},
	run: ({ args }) => {
		const io = getCliIo();
		const search = typeof args.search === "string" ? args.search : args._[0];
		return runHumanCommand(
			io,
			makeAuthFromArgs(args).listModels(search),
			(models) => renderModels(search, models),
			"Configure provider auth or pass a valid --cwd/--plot-dir/--agent-dir.",
		);
	},
});
