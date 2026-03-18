import { Command } from "@effect/cli";
import { Effect, FiberRef } from "effect";
import { createCliOutput, ensureJsonSupported } from "../shared/io.js";
import { cliCommandOptions, toServerOptions } from "../shared/options.js";
import { startServer, waitForServer } from "../shared/server-process.js";

export const WebCommand = Command.make("web", cliCommandOptions,
  Effect.fnUntraced(function* (args) {
    ensureJsonSupported(args.json, "web");
    const output = createCliOutput(args);
    const logLevel = yield* FiberRef.get(FiberRef.currentMinimumLogLevel);
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
