import { Command } from "effect/unstable/cli";
import { Effect, FiberRef } from "effect";
import { createCliOutput } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer } from "../shared/server-process.js";

export const ServeCommand = Command.make("serve", cliCommandOptions,
  Effect.fnUntraced(function* (args) {
    const output = createCliOutput(args);
    const logLevel = yield* FiberRef.get(FiberRef.currentMinimumLogLevel);
    const handle = startServer(toServerOptions(args, logLevel));
    output.ready({ command: "serve", url: handle.url, pid: handle.pid });

    yield* waitForShutdown((signal) => {
      output.shutdown({ command: "serve", signal });
      handle.stop();
    });
  }),
).pipe(Command.withDescription("start the plot orchestrator server (headless)"));

function waitForShutdown(onShutdown: (signal: NodeJS.Signals) => void) {
  return Effect.async<void>((resume) => {
    const shutdown = (signal: NodeJS.Signals) => {
      onShutdown(signal);
      resume(Effect.void);
    };
    const onSigint = () => shutdown("SIGINT");
    const onSigterm = () => shutdown("SIGTERM");
    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);
    return Effect.sync(() => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    });
  });
}
