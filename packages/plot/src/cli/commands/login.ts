import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { loginWithPlotAuth } from "../shared/auth.js";

export const LoginCommand = Command.make(
	"login",
	{
		provider: Args.text({ name: "provider" }).pipe(Args.optional),
	},
	({ provider }) =>
		Effect.promise(() => loginWithPlotAuth(Option.getOrUndefined(provider))),
).pipe(Command.withDescription("login to a model provider for plot"));
