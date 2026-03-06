import type { CommandModule } from "yargs";
import { ensureJsonSupported, ensureTuiSupported } from "../shared/io.js";
import {
	withCliCommandOptions,
	type ServerOptions,
} from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";
import { resolveSelfCommandArgs } from "../shared/runtime.js";

export const TuiCommand: CommandModule<{}, ServerOptions> = {
	command: "$0",
	describe: "start server and launch TUI dashboard",
	builder: (yargs) => withCliCommandOptions(yargs),
	handler: async (args) => {
		ensureJsonSupported(args.json, "tui");
		ensureTuiSupported();
		const handle = startServer(args);

		let tui: ReturnType<typeof Bun.spawn> | undefined;

		const shutdown = () => {
			tui?.kill();
			handle.stop();
			process.exit(0);
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);

		await waitForServer(handle.url);

		tui = Bun.spawn(resolveSelfCommandArgs("__internal-tui"), {
			stdio: ["inherit", "inherit", "inherit"],
			env: {
				...process.env,
				PLOT_URL: `http://localhost:${args.port}`,
			},
		});

		const exitCode = await tui.exited;
		handle.stop();
		process.exit(exitCode);
	},
};
