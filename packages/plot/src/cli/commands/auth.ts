import { Argument, Command } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { loginWithPlotAuth, logoutWithPlotAuth, printPlotAuthStatus } from "../shared/auth.js";

export const AuthCommand = Command.make(
  "auth",
  {
    action: Argument.choice("action", ["status", "login", "logout"] as const),
    provider: Argument.string("provider").pipe(Argument.optional),
  },
  Effect.fnUntraced(function* ({ action, provider }) {
      const providerId = Option.getOrUndefined(provider);
      switch (action) {
        case "status":
          yield* Effect.sync(printPlotAuthStatus);
          return;
        case "login":
          yield* Effect.promise(() => loginWithPlotAuth(providerId));
          return;
        case "logout":
          yield* Effect.promise(() => logoutWithPlotAuth(providerId));
          return;
      }
    }),
).pipe(Command.withDescription("manage plot auth"));
