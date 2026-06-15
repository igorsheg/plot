import { defineCommand } from "citty";
import { pathArgs } from "../args.js";
import { getCliIo } from "../cli-context.js";
import {
	restartLocalService,
	startLocalService,
	statusLocalService,
	stopLocalService,
} from "../runtime.js";
import { str } from "../options.js";

const serviceOptions = (args: Record<string, unknown>) => ({
	cwd: str(args, "cwd") ?? process.cwd(),
});

export const serviceCommand = defineCommand({
	meta: {
		name: "service",
		description: "Manage the shared Local Plot Server daemon.",
	},
	subCommands: {
		start: defineCommand({
			meta: { name: "start", description: "Start the Local Plot Server." },
			args: { cwd: pathArgs.cwd },
			run: ({ args }) => {
				const io = getCliIo();
				return startLocalService({
					...serviceOptions(args),
					writeStdout: io.writeStdout,
				});
			},
		}),
		status: defineCommand({
			meta: { name: "status", description: "Print Local Plot Server status." },
			run: () => {
				const io = getCliIo();
				return statusLocalService({ writeStdout: io.writeStdout });
			},
		}),
		stop: defineCommand({
			meta: { name: "stop", description: "Stop the Local Plot Server." },
			run: () => {
				const io = getCliIo();
				return stopLocalService({ writeStdout: io.writeStdout });
			},
		}),
		restart: defineCommand({
			meta: { name: "restart", description: "Restart the Local Plot Server." },
			args: { cwd: pathArgs.cwd },
			run: ({ args }) => {
				const io = getCliIo();
				return restartLocalService({
					...serviceOptions(args),
					writeStdout: io.writeStdout,
				});
			},
		}),
	},
});
