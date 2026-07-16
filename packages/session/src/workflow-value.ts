import type { ExtensionCredentials, Workflow } from "@plot/sdk";
import { resolveSessionPaths } from "./paths.js";
import {
	createMemoryAgentEnvironment,
	type ProviderCredentials,
} from "./agent-session-memory.js";
import type { PreparedWorkflow } from "./workflow-plan.js";

export type { ProviderCredentials } from "./agent-session-memory.js";

export const createMemoryExtensionCredentials = () => {
	const values = new Map<string, unknown>();
	return {
		get: async (key: string) => values.get(key),
		set: async (key: string, value: unknown) => {
			values.set(key, value);
		},
		delete: async (key: string) => {
			values.delete(key);
		},
		clear: () => values.clear(),
	};
};

export const prepareWorkflowValue = async (options: {
	readonly cwd: string;
	readonly workflow: Workflow<unknown>;
	readonly providerCredentials: ProviderCredentials;
	readonly extensionCredentials: ExtensionCredentials;
}): Promise<PreparedWorkflow> => {
	const { workflow } = options;
	const paths = resolveSessionPaths({ cwd: options.cwd });
	const input = workflow.extension.config;
	const extensionConfig = workflow.extension.use.parseConfig
		? await workflow.extension.use.parseConfig(input)
		: input;
	const agent = createMemoryAgentEnvironment({
		workflow,
		paths,
		credentials: options.providerCredentials,
	});
	return {
		identity: workflow,
		paths,
		credentials: options.extensionCredentials,
		createAgentSession: agent.createAgentSession,
		dispose: agent.dispose,
		plan: {
			name: workflow.name,
			agent: workflow.agent,
			plot: workflow.plot,
			prompt: workflow.prompt,
			extension: workflow.extension.use,
			extensionConfig,
			maxConcurrentRuns: workflow.extension.maxConcurrentRuns ?? 1,
			definition: workflow,
		},
	};
};
