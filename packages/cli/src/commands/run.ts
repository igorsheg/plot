import { randomUUID } from "node:crypto";
import { defineCommand } from "citty";
import { sessionCommandArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { baseOptions, bool, str } from "../options.js";
import { renderRunEvent, renderRunHistoryEvent } from "../render.js";
import { runControlOneshot, runInProcessOnce } from "../runtime.js";

export const runCommand = defineCommand({
	meta: {
		name: "run",
		description:
			"Run a workflow once through the Local Plot Server without opening the dashboard.",
	},
	args: {
		...sessionCommandArgs,
		"no-server": {
			type: "boolean",
			description:
				"Explicit escape hatch: run an in-process session instead of the Local Plot Server.",
		},
	},
	async run({ args, rawArgs }) {
		const io = getCliIo();
		const noServer = bool(args, "no-server") || rawArgs.includes("--no-server");
		const base = {
			...baseOptions(args),
			sessionId: str(args, "session-id") ?? `oneshot-${randomUUID()}`,
		};
		try {
			if (noServer) {
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
				return;
			}
			await runControlOneshot({
				...base,
				onEvent: async (event) => {
					const line = renderRunHistoryEvent(event);
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
