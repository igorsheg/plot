import { Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { getProviders, getModels } from "@mariozechner/pi-ai";
import { emitResult, type NextAction } from "../shared/envelope.js";
import { createPlotAuthStorage } from "../shared/auth.js";

export const ModelsCommand = Command.make(
	"models",
	{},
	() =>
		Effect.sync(() => {
			const providers = getProviders();
			const authStorage = createPlotAuthStorage();
			const oauthProviderIds = new Set(authStorage.getOAuthProviders().map((p) => p.id));

			const result = providers.map((providerId) => {
				const models = getModels(providerId);
				return {
					id: providerId,
					authenticated: authStorage.has(providerId),
					models: models.map((m) => ({
						id: m.id,
						name: m.name,
						provider: m.provider,
						reasoning: m.reasoning,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
						cost: m.cost,
					})),
				};
			});

			const unauthenticated = result
				.filter((p) => !p.authenticated && oauthProviderIds.has(p.id))
				.map((p) => p.id);
			const nextActions: NextAction[] = [
				{ command: "plot-ai serve", description: "start the server" },
				{ command: "plot-ai auth status", description: "check authentication status" },
			];
			if (unauthenticated.length > 0) {
				nextActions.unshift({
					command: "plot-ai auth login <provider>",
					description: "authenticate with a provider",
					params: {
						provider: {
							enum: unauthenticated,
							description: "unauthenticated provider ID",
							required: true,
						},
					},
				});
			}

			emitResult("plot-ai models", { providers: result }, nextActions);
		}),
).pipe(Command.withDescription("list available providers and models"));
