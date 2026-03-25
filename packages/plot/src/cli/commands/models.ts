import { Command } from "effect/unstable/cli";
import { Effect } from "effect";
import { getProviders, getModels } from "@mariozechner/pi-ai";
import { writeNdjson } from "../shared/io.js";

export const ModelsCommand = Command.make(
	"models",
	{},
	() =>
		Effect.sync(() => {
			const providers = getProviders();
			const result = providers.map((providerId) => {
				const models = getModels(providerId);
				return {
					id: providerId,
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
			writeNdjson("models:list", { providers: result });
		}),
).pipe(Command.withDescription("list available providers and models"));
