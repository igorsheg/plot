import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { createCliOutput, ensureJsonSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";
import { waitForShutdown } from "../shared/shutdown.js";

export const WebCommand = Command.make(
	"web",
	cliCommandOptions,
	Effect.fnUntraced(function* (args) {
		ensureJsonSupported(args.json, "web");
		const output = createCliOutput(args);
		const logLevel = yield* References.MinimumLogLevel;
		const handle = startServer(toServerOptions(args, logLevel, { web: true }));

		yield* Effect.promise(() => waitForServer(handle.url));
		output.ready({ command: "web", url: handle.url, pid: handle.pid });
		output.info(`open ${handle.url} in your browser`);

		yield* waitForShutdown((signal) => {
			output.shutdown({ command: "web", signal });
			handle.stop();
		});
	}),
).pipe(Command.withDescription("start server and serve the web dashboard"));
