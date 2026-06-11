import { defineCommand } from "citty";
import { commonArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { baseOptions } from "../options.js";
import { renderRunEvent } from "../render.js";
import { runDaemon } from "../runtime.js";

export const runCommand = defineCommand({
	meta: {
		name: "run",
		description: "Run a workflow without opening the dashboard.",
	},
	args: commonArgs,
	async run({ args }) {
		const io = getCliIo();
		try {
			await runDaemon({
				...baseOptions(args),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				onEvent: async (event) => {
					const line = renderRunEvent(event);
					if (line) await io.writeStdout(line);
				},
			});
		} catch (error) {
			await writeCliStderr(
				io,
				`Error: ${errorMessage(error)}\nFix: Check WORKFLOW.md, auth status, and provider/model settings.\n`,
			);
			throw error;
		}
	},
});
