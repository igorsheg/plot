import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { errorMessage } from "@plot/common/primitives";
import { sessionCommandArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { baseOptions, str } from "../options.js";
import { renderRunEvent } from "../render.js";
import { runInProcessOnce } from "../runtime.js";

export const runCommand = defineCommand({
	meta: {
		name: "run",
		description: "Run a workflow once without opening the dashboard.",
	},
	args: { ...workflowPathArg, ...sessionCommandArgs },
	async run({ args, rawArgs }) {
		const io = getCliIo();
		void rawArgs;
		const base = baseOptions(args);
		base.sessionId = str(args, "session-id") ?? `oneshot-${randomUUID()}`;
		try {
			if (io.createAgentSession !== undefined)
				base.createAgentSession = io.createAgentSession;
			base.onEvent = async (event) => {
				const line = renderRunEvent(event);
				if (line) await io.writeStdout(line);
			};
			await runInProcessOnce(base);
		} catch (error) {
			await writeCliStderr(
				io,
				`Error: ${errorMessage(error)}\nFix: Check WORKFLOW.md, auth status, and provider/model settings.\n`,
			);
			throw error;
		}
	},
});
