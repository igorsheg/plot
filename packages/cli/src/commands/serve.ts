import type { CommandModule } from "yargs";
import { createCliOutput } from "../shared/io.js";
import {
	withCliCommandOptions,
	type ServerOptions,
} from "../shared/options.js";
import { startServer } from "../shared/server-process.js";

export const ServeCommand: CommandModule<{}, ServerOptions> = {
	command: "serve",
	describe: "start the plot orchestrator server (headless)",
	builder: (yargs) => withCliCommandOptions(yargs),
	handler: async (args) => {
		const output = createCliOutput(args);
		const handle = startServer(args);
		output.ready({ command: "serve", url: handle.url, pid: handle.pid });

		const shutdown = (signal: NodeJS.Signals) => {
			output.shutdown({ command: "serve", signal });
			handle.stop();
			process.exit(0);
		};
		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		await new Promise(() => {});
	},
};
