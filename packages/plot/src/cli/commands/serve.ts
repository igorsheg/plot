import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { diagnostic, emitStream, emitStreamResult } from "../shared/envelope.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer } from "../shared/server-process.js";
import { waitForShutdown } from "../shared/shutdown.js";

export const ServeCommand = Command.make(
	"serve",
	cliCommandOptions,
	Effect.fn(function* (args) {
		const startTime = Date.now();
		const logLevel = yield* References.MinimumLogLevel;
		const handle = startServer(toServerOptions(args, logLevel));

		emitStream({ type: "start", command: "plot-ai serve", ts: new Date().toISOString() });
		emitStream({
			type: "log",
			level: "info",
			message: `listening on ${handle.url}`,
			ts: new Date().toISOString(),
		});
		diagnostic(`plot-ai serve listening on ${handle.url}`, args.verbose);

		yield* waitForShutdown((signal) => {
			emitStreamResult(
				"plot-ai serve",
				{ url: handle.url, signal, uptime_ms: Date.now() - startTime },
				[
					{ command: "plot-ai auth status", description: "check authentication status" },
					{
						command: `curl http://localhost:${args.port}/health`,
						description: "verify server health",
					},
				],
			);
			handle.stop();
		});
	}),
).pipe(Command.withDescription("start the plot orchestrator server (headless)"));
