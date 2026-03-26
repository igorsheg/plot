import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { diagnostic, emitStream, emitStreamResult } from "../shared/envelope.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";
import { waitForShutdown } from "../shared/shutdown.js";

export const WebCommand = Command.make(
	"web",
	cliCommandOptions,
	Effect.fnUntraced(function* (args) {
		const startTime = Date.now();
		emitStream({ type: "start", command: "plot-ai web", ts: new Date().toISOString() });

		const logLevel = yield* References.MinimumLogLevel;
		const handle = startServer(toServerOptions(args, logLevel, { web: true }));

		yield* Effect.promise(() => waitForServer(handle.url));
		emitStream({
			type: "log",
			level: "info",
			message: `web dashboard available at ${handle.url}`,
			ts: new Date().toISOString(),
		});
		diagnostic(`open ${handle.url} in your browser`, args.verbose);

		const nextActions = [
			{ command: "plot-ai serve", description: "start headless server (no web dashboard)" },
			{ command: "plot-ai auth status", description: "check authentication status" },
		];

		yield* waitForShutdown((signal) => {
			emitStreamResult(
				"plot-ai web",
				{ url: handle.url, signal, uptime_ms: Date.now() - startTime },
				nextActions,
			);
			handle.stop();
		});
	}),
).pipe(Command.withDescription("start server and serve the web dashboard"));
