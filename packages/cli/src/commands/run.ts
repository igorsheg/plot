import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { baseOptions, str } from "../options.js";
import { renderRunEvent } from "../render.js";
import { runInProcessOnce } from "../runtime.js";
import { cliSemantics } from "../semantics.js";

export const runCommand = defineCommand({
	meta: {
		name: "run",
		description: cliSemantics.run.description,
	},
	args: sessionCommandArgs,
	async run({ args, rawArgs }) {
		const io = getCliIo();
		void rawArgs;
		const base = {
			...baseOptions(args),
			sessionId: str(args, "session-id") ?? `oneshot-${randomUUID()}`,
		};
		try {
			await runInProcessOnce({
				...base,
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
