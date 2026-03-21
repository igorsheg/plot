import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { createCliOutput } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer } from "../shared/server-process.js";
import { waitForShutdown } from "../shared/shutdown.js";

export const ServeCommand = Command.make(
	"serve",
	cliCommandOptions,
	Effect.fnUntraced(function* (args) {
		const output = createCliOutput(args);
		const logLevel = yield* References.MinimumLogLevel;
		const handle = startServer(toServerOptions(args, logLevel));
		output.ready({ command: "serve", url: handle.url, pid: handle.pid });

		yield* waitForShutdown((signal) => {
			output.shutdown({ command: "serve", signal });
			handle.stop();
		});
	}),
).pipe(Command.withDescription("start the plot orchestrator server (headless)"));
