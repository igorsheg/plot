import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { loginWithPlotAuth, logoutWithPlotAuth, printPlotAuthStatus } from "../shared/auth.js";

export const AuthCommand = Command.make(
  "auth",
  {
    action: Args.choice(
      [
        ["status", "status"],
        ["login", "login"],
        ["logout", "logout"],
      ] as const,
      { name: "action" },
    ),
    provider: Args.text({ name: "provider" }).pipe(Args.optional),
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
