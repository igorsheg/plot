import { getProviders as piGetProviders, getModels as piGetModels } from "@mariozechner/pi-ai";
import type { KnownProvider } from "@mariozechner/pi-ai";

export type CatalogModel = {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	contextWindow: number;
	maxTokens: number;
};

export type CatalogProvider = {
	id: string;
	modelCount: number;
	models: CatalogModel[];
};

export function getCatalogProviders(): CatalogProvider[] {
	return piGetProviders().map((providerId) => {
		const models = piGetModels(providerId);
		return {
			id: providerId,
			modelCount: models.length,
			models: models.map((m) => ({
				id: m.id,
				name: m.name,
				provider: m.provider,
				reasoning: m.reasoning,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
			})),
		};
	});
}

export function getCatalogModels(providerId: string): CatalogModel[] {
	const models = piGetModels(providerId as KnownProvider);
	return models.map((m) => ({
		id: m.id,
		name: m.name,
		provider: m.provider,
		reasoning: m.reasoning,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
	}));
}
