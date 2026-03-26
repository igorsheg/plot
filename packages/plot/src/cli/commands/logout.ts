import { Argument, Command } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { logoutWithPlotAuth } from "../shared/auth.js";

export const LogoutCommand = Command.make(
	"logout",
	{
		provider: Argument.string("provider").pipe(Argument.optional),
	},
	({ provider }) => Effect.promise(() => logoutWithPlotAuth(Option.getOrUndefined(provider))),
).pipe(Command.withDescription("revoke credentials for a model provider"));
