import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import {
	diagnostic,
	emitStream,
	emitStreamResult,
} from "../shared/envelope.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";
import { resolveBundledWebDistDir } from "../shared/runtime.js";
import { startWebServer } from "../../web-server.js";
import { waitForShutdown } from "../shared/shutdown.js";

/** Engine runs on user port + 100 to keep the user-facing port for the web server. */
const ENGINE_PORT_OFFSET = 100;

export const WebCommand = Command.make(
	"web",
	cliCommandOptions,
	Effect.fn(function* (args) {
		const startTime = Date.now();
		emitStream({
			type: "start",
			command: "plot-ai web",
			ts: new Date().toISOString(),
		});

		const logLevel = yield* References.MinimumLogLevel;

		const enginePort = args.port + ENGINE_PORT_OFFSET;
		const engineHandle = startServer(
			toServerOptions({ ...args, port: enginePort }, logLevel),
		);
		const engineUrl = engineHandle.url;

		yield* Effect.promise(() => waitForServer(engineUrl)).pipe(
			Effect.tapError(() => Effect.sync(() => engineHandle.stop())),
		);

		const webDistDir = resolveBundledWebDistDir();
		const webHandle = startWebServer({
			port: args.port,
			engineUrl,
			webDistDir,
		});

		emitStream({
			type: "log",
			level: "info",
			message: `web dashboard available at ${webHandle.url}`,
			ts: new Date().toISOString(),
		});
		diagnostic(`open ${webHandle.url} in your browser`, args.verbose);

		const nextActions = [
			{
				command: "plot-ai serve",
				description: "start headless server (no web dashboard)",
			},
			{
				command: "plot-ai auth status",
				description: "check authentication status",
			},
		];

		yield* waitForShutdown((signal) => {
			emitStreamResult(
				"plot-ai web",
				{ url: webHandle.url, signal, uptime_ms: Date.now() - startTime },
				nextActions,
			);
			webHandle.stop();
			engineHandle.stop();
		});
	}),
).pipe(Command.withDescription("start server and serve the web dashboard"));
