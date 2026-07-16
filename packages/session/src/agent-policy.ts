import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { BoundaryError } from "@plot/common/boundary-error";
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
		throw new BoundaryError({
			code: "model_not_found",
			message: `Model not found: ${agent.provider}/${agent.model}`,
			retryable: false,
			context: { provider: agent.provider, model: agent.model },
		});
	return model;
};
