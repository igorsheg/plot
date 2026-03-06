import type { CommandModule } from "yargs";
import {
	CliError,
	createCliOutput,
	ensureJsonSupported,
} from "../shared/io.js";
import {
	withCliCommandOptions,
	type ServerOptions,
} from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";

function openBrowser(url: string) {
	const { platform } = process;
	const cmd =
		platform === "darwin"
			? "open"
			: platform === "win32"
				? "start"
				: "xdg-open";
	const proc = Bun.spawn([cmd, url], { stdio: ["ignore", "ignore", "ignore"] });
	proc.exited.catch(() => undefined);
}

export const WebCommand: CommandModule<{}, ServerOptions> = {
	command: "web",
	describe: "start server and open web dashboard",
	builder: (yargs) => withCliCommandOptions(yargs),
	handler: async (args) => {
		ensureJsonSupported(args.json, "web");
		const output = createCliOutput(args);
		const handle = startServer(args);

		const shutdown = (signal: NodeJS.Signals) => {
			output.shutdown({ command: "web", signal });
			handle.stop();
			process.exit(0);
		};
		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		await waitForServer(handle.url);
		output.ready({ command: "web", url: handle.url, pid: handle.pid });

		try {
			openBrowser(handle.url);
		} catch {
			throw new CliError(
				"runtime",
				`failed to open browser for ${handle.url}`,
				1,
			);
		}

		await new Promise(() => {});
	},
};
