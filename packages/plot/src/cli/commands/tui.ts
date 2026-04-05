import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { runTui } from "@plot/tui";
import { TuiStartupError } from "../../core/errors.js";
import { ensureTuiSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { createTuiRuntimeHandle } from "../shared/tui-runtime.js";
import { runRpcMain } from "../../rpc-main.js";
import { toServerEnv } from "../shared/runtime.js";

export function createTuiCommand(name: string) {
	return Command.make(
		name,
		cliCommandOptions,
		Effect.fn(function* (args) {
			if (args.mode === "rpc") {
				const logLevel = yield* References.MinimumLogLevel;
				const serverOpts = toServerOptions(args, logLevel);
				const env = toServerEnv(serverOpts);
				yield* Effect.promise(() => runRpcMain(env));
				return;
			}

			ensureTuiSupported();
			const logLevel = yield* References.MinimumLogLevel;
			const runtime = yield* Effect.promise(() =>
				createTuiRuntimeHandle(toServerOptions(args, logLevel)),
			).pipe(
				Effect.mapError(
					(error) =>
						new TuiStartupError({
							message:
								"failed to start tui runtime; logs: ~/.plot/logs/tui-server.log",
							cause: error,
						}),
				),
			);

			yield* Effect.promise(() => runTui({ api: runtime.api })).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						runtime.close();
					}),
				),
			);
		}),
	).pipe(Command.withDescription("start server and launch TUI dashboard"));
}
