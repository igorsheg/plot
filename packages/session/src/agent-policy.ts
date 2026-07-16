import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AgentConfig } from "@plot/sdk";

export const resolveNoTools = (
	mode: AgentConfig["noTools"],
): "all" | "builtin" | undefined => {
	if (mode === undefined || mode === false) return;
	if (mode === true) return "all";
	return mode;
};

export const configuredModel = (
	registry: ModelRegistry,
	agent: AgentConfig,
) => {
	const model = registry.find(agent.provider, agent.model);
	if (model === undefined)
		throw new Error(`Model not found: ${agent.provider}/${agent.model}`);
	return model;
};
