import { defineCommand } from "citty";
import { getCliIo } from "../cli-context.js";
import { runHumanCommand } from "../io.js";
import { makeAuth } from "../options.js";
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
	},
	run: ({ args }) => {
		const io = getCliIo();
		const search = typeof args.search === "string" ? args.search : args._[0];
		return runHumanCommand(
			io,
			makeAuth().listModels(search),
			(models) => renderModels(search, models),
			"Configure provider auth with `plot auth login`.",
		);
	},
});
