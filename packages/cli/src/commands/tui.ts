import { Command } from "@effect/cli";
import { Effect, FiberRef } from "effect";
import { ensureJsonSupported, ensureTuiSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";
import { resolveSelfCommandArgs } from "../shared/runtime.js";

export function createTuiCommand(name: string) {
	return Command.make(name, cliCommandOptions, (args) =>
		Effect.gen(function* () {
			ensureJsonSupported(args.json, "tui");
			ensureTuiSupported();
			const logLevel = yield* FiberRef.get(FiberRef.currentMinimumLogLevel);
			const handle = startServer(toServerOptions(args, logLevel));
			yield* Effect.promise(() => waitForServer(handle.url));

			const tui = Bun.spawn(resolveSelfCommandArgs("__internal-tui"), {
				stdio: ["inherit", "inherit", "inherit"],
				env: {
					...process.env,
					PLOT_URL: `http://localhost:${args.port}`,
				},
			});

			const exitCode = yield* Effect.promise(() => tui.exited);
			handle.stop();
			process.exit(exitCode);
		}),
	).pipe(Command.withDescription("start server and launch TUI dashboard"));
}
