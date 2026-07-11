import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { errorMessage } from "@plot/common/primitives";
import { ExtensionSetupRequiredError } from "@plot/session/readiness";
import { sessionCommandArgs, workflowPathArg } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { writeCliStderr } from "../io.js";
import { baseOptions, str } from "../options.js";
import { renderRunEvent } from "../render.js";
import type { RuntimeEvent } from "@plot/session/runtime";
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
		try {
			await runInProcessOnce({
				...baseOptions(args),
				sessionId: str(args, "session-id") ?? `oneshot-${randomUUID()}`,
				createAgentSession: io.createAgentSession,
				onEvent: async (event: RuntimeEvent) => {
					const line = renderRunEvent(event);
					if (line) await io.writeStdout(line);
				},
			} as Parameters<typeof runInProcessOnce>[0]);
		} catch (error) {
			const fix =
				error instanceof ExtensionSetupRequiredError
					? "Run `plot setup WORKFLOW.md`."
					: "Check WORKFLOW.md, auth status, and provider/model settings.";
			await writeCliStderr(io, `Error: ${errorMessage(error)}\nFix: ${fix}\n`);
			throw error;
		}
	},
});
