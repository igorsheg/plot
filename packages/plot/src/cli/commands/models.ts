import { Command, Flag } from "effect/unstable/cli";
import { Effect } from "effect";
import { getProviders, getModels } from "@mariozechner/pi-ai";
import { emitResult, type NextAction } from "../shared/envelope.js";
import { createPlotAuthStorage } from "../shared/auth.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const MODELS_PER_PROVIDER = 3;

export const ModelsCommand = Command.make(
	"models",
	{ all: Flag.boolean("all").pipe(Flag.withDescription("show all models (large output)")) },
	({ all }) =>
		Effect.sync(() => {
			const providers = getProviders();
			const authStorage = createPlotAuthStorage();
			const oauthProviderIds = new Set(authStorage.getOAuthProviders().map((p) => p.id));

			const fullProviders = providers.map((providerId) => {
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

			const totalModels = fullProviders.reduce((sum, p) => sum + p.models.length, 0);

			const unauthenticated = fullProviders
				.filter((p) => !p.authenticated && oauthProviderIds.has(p.id))
				.map((p) => p.id);
			const nextActions: NextAction[] = [
				{ command: "plot-ai --mode rpc", description: "start headless JSON-RPC mode" },
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

			if (all) {
				emitResult("plot-ai models", { providers: fullProviders, total_models: totalModels }, nextActions);
				return;
			}

			const cacheDir = join(homedir(), ".plot", "cache");
			mkdirSync(cacheDir, { recursive: true });
			const fullPath = join(cacheDir, `models-${Date.now()}.json`);
			writeFileSync(fullPath, JSON.stringify({ providers: fullProviders, total_models: totalModels }, null, 2));

			const truncatedProviders = fullProviders.map((p) => ({
				id: p.id,
				authenticated: p.authenticated,
				model_count: p.models.length,
				models: p.models.slice(0, MODELS_PER_PROVIDER),
			}));

			nextActions.push({
				command: `cat ${fullPath}`,
				description: `view all ${totalModels} models (full output)`,
			});
			nextActions.push({
				command: "plot-ai models --all",
				description: "output all models inline (large)",
			});

			emitResult(
				"plot-ai models",
				{
					providers: truncatedProviders,
					total_models: totalModels,
					truncated: true,
					models_per_provider: MODELS_PER_PROVIDER,
					full_output: fullPath,
				},
				nextActions,
			);
		}),
).pipe(Command.withDescription("list available providers and models"));
