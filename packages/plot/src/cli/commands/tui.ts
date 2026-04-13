import { Command } from "effect/unstable/cli";
import { Effect, Option, References } from "effect";
import { runTui } from "@plot/tui";
import { runRpcMain } from "../../rpc-main.js";
import { TuiStartupError } from "../../core/errors.js";
import { ensureTuiSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { createTuiRuntimeHandle } from "../shared/tui-runtime.js";

export function createRootCommand(name: string) {
	return Command.make(
		name,
		cliCommandOptions,
		Effect.fn(function* (args) {
			const mode = Option.getOrUndefined(args.mode);
			if (mode === "rpc") {
				yield* Effect.promise(() => runRpcMain());
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
	).pipe(Command.withDescription("AI-powered coding agent orchestrator"));
}
