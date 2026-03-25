import { Argument, Command } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import {
	loginWithPlotAuth,
	loginWithPlotAuthJson,
	logoutWithPlotAuth,
	printPlotAuthStatus,
	printPlotAuthStatusJson,
} from "../shared/auth.js";

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
				if (process.argv.includes("--json")) {
					yield* Effect.sync(printPlotAuthStatusJson);
				} else {
					yield* Effect.sync(printPlotAuthStatus);
				}
				return;
			case "login":
				if (process.argv.includes("--json")) {
					yield* Effect.promise(() => loginWithPlotAuthJson(providerId));
				} else {
					yield* Effect.promise(() => loginWithPlotAuth(providerId));
				}
				return;
			case "logout":
				yield* Effect.promise(() => logoutWithPlotAuth(providerId));
				return;
		}
	}),
).pipe(Command.withDescription("manage plot auth"));
