import { Argument, Command } from "effect/unstable/cli";
import { Effect, Option } from "effect";
import { emitResult, type NextAction } from "../shared/envelope.js";
import {
	createPlotAuthStorage,
	loginWithPlotAuthJson,
	logoutWithPlotAuth,
} from "../shared/auth.js";

function authNextActions(providerId?: string): NextAction[] {
	const actions: NextAction[] = [
		{ command: "plot-ai auth status", description: "check authentication status" },
		{
			command: "plot-ai auth login <provider>",
			description: "authenticate with a provider",
			params: { provider: { description: "provider ID", ...(providerId ? { value: providerId } : {}) } },
		},
		{ command: "plot-ai models", description: "list available providers and models" },
	];
	return actions;
}

export const AuthCommand = Command.make(
	"auth",
	{
		action: Argument.choice("action", ["status", "login", "logout"] as const),
		provider: Argument.string("provider").pipe(Argument.optional),
	},
	Effect.fnUntraced(function* ({ action, provider }) {
		const providerId = Option.getOrUndefined(provider);
		switch (action) {
			case "status": {
				const authStorage = createPlotAuthStorage();
				const providers = authStorage.getOAuthProviders();
				const result = providers.map((p) => ({
					id: p.id,
					name: p.name,
					authenticated: authStorage.has(p.id),
				}));
				emitResult("plot-ai auth status", { providers: result }, authNextActions());
				return;
			}
			case "login": {
				yield* Effect.promise(() => loginWithPlotAuthJson(providerId));
				return;
			}
			case "logout": {
				yield* Effect.promise(() => logoutWithPlotAuth(providerId));
				emitResult("plot-ai auth logout", { provider: providerId }, authNextActions());
				return;
			}
		}
	}),
).pipe(Command.withDescription("manage authentication (status, login, logout)"));
