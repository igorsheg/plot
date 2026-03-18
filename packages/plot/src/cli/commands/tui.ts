import { Command } from "effect/unstable/cli";
import { Effect, References } from "effect";
import { runTui } from "@plot/tui";
import { ensureJsonSupported, ensureTuiSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { createTuiRuntimeHandle } from "../shared/tui-runtime.js";

export function createTuiCommand(name: string) {
  return Command.make(name, cliCommandOptions,
    Effect.fnUntraced(function* (args) {
      ensureJsonSupported(args.json, "tui");
      ensureTuiSupported();
      const logLevel = yield* References.MinimumLogLevel;
      const runtime = yield* Effect.promise(() =>
        createTuiRuntimeHandle(toServerOptions(args, logLevel)),
      ).pipe(
        Effect.mapError(
          (error) =>
            new Error("failed to start tui runtime; logs: ~/.plot/logs/tui-server.log", {
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
