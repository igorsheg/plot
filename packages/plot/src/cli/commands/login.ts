import { Argument, Command } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { loginWithPlotAuth } from "../shared/auth.js";

export const LoginCommand = Command.make(
	"login",
	{
		provider: Argument.string("provider").pipe(Argument.optional),
	},
	({ provider }) => Effect.promise(() => loginWithPlotAuth(Option.getOrUndefined(provider))),
).pipe(Command.withDescription("authenticate with a model provider (interactive)"));
