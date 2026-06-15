import { defineCommand } from "citty";
import { loggingArgs, pathArgs, workflowArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, writeCliStderr } from "../io.js";
import { baseOptions, bool, int, str } from "../options.js";
import { runWebDashboard } from "../runtime.js";

const roleFrom = (value: string | undefined): "observer" | "controller" =>
	value === "observer" ? "observer" : "controller";

export const webCommand = defineCommand({
	meta: {
		name: "web",
		description: "Start the local web control plane and hold until Ctrl-C.",
	},
	args: {
		"session-id": {
			...workflowArgs["session-id"],
			description: "Existing Plot session id to open directly.",
		},
		hostname: {
			type: "string",
			description: "Listen hostname. Default: localhost.",
			valueHint: "host",
		},
		port: {
			type: "string",
			description:
				"Listen port. Default prefers the stable local Plot port; 0 uses an ephemeral port.",
			valueHint: "port",
		},
		cwd: pathArgs.cwd,
		...loggingArgs,
		role: {
			type: "string",
			description:
				"Control role for the browser connection: controller or observer.",
			valueHint: "role",
		},
		fleet: {
			type: "boolean",
			description:
				"Open the fleet view even when only one session is reachable.",
		},
		"no-open": {
			type: "boolean",
			description:
				"Print the browser URL instead of opening it. The server still runs until Ctrl-C.",
		},
	},
	async run({ args, rawArgs }) {
		const io = getCliIo();
		const noOpen = bool(args, "no-open") || rawArgs.includes("--no-open");
		const hostname = str(args, "hostname");
		const port = int(args, "port");
		try {
			const selectedSessionId = str(args, "session-id");
			await runWebDashboard({
				...baseOptions(args),
				...(hostname === undefined ? {} : { hostname }),
				...(port === undefined ? {} : { port }),
				...(selectedSessionId === undefined ? {} : { selectedSessionId }),
				role: roleFrom(str(args, "role")),
				...(bool(args, "fleet") || rawArgs.includes("--fleet")
					? { explicitFleet: true }
					: {}),
				...(noOpen ? { noOpen: true } : {}),
				writeStdout: io.writeStdout,
			});
		} catch (error) {
			await writeCliStderr(
				io,
				`Error: ${errorMessage(error)}\nFix: Ensure the Local Plot Server can start and the web assets are bundled or built.\n`,
			);
			throw error;
		}
	},
});
