import { Args, Command } from "@effect/cli";
import { Effect, Option } from "effect";
import { logoutWithPlotAuth } from "../shared/auth.js";

export const LogoutCommand = Command.make(
	"logout",
	{
		provider: Args.text({ name: "provider" }).pipe(Args.optional),
	},
	({ provider }) =>
		Effect.promise(() => logoutWithPlotAuth(Option.getOrUndefined(provider))),
).pipe(Command.withDescription("logout from a model provider for plot"));
