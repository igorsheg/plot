import type { CommandModule } from "yargs";
import { createCliOutput, ensureJsonSupported } from "../shared/io.js";
import {
	withCliCommandOptions,
	type ServerOptions,
} from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";

export const WebCommand: CommandModule<{}, ServerOptions> = {
	command: "web",
	describe: "start server and serve the web dashboard",
	builder: (yargs) => withCliCommandOptions(yargs),
	handler: async (args) => {
		ensureJsonSupported(args.json, "web");
		const output = createCliOutput(args);
		const handle = startServer({ ...args, web: true });

		const shutdown = (signal: NodeJS.Signals) => {
			output.shutdown({ command: "web", signal });
			handle.stop();
			process.exit(0);
		};
		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		await waitForServer(handle.url);
		output.ready({ command: "web", url: handle.url, pid: handle.pid });
		output.info(`open ${handle.url} in your browser`);

		await new Promise(() => {});
	},
};
