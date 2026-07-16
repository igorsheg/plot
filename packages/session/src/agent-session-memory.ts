import {
	AuthStorage,
	createAgentSessionFromServices,
	createExtensionRuntime,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type AgentSessionServices,
	type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { BoundaryError } from "@plot/common/boundary-error";
import type { Workflow } from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import { configuredModel, resolveNoTools } from "./agent-policy.js";
import type { CreateAgentSession } from "./agent-runner.js";

export type ProviderCredentials = Record<string, { readonly apiKey: string }>;

const literalResources = (resources: Workflow["resources"]): ResourceLoader => {
	const extensions = {
		extensions: [],
		errors: [],
		runtime: createExtensionRuntime(),
	};
	return {
		getExtensions: () => extensions,
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => resources?.systemPrompt,
		getAppendSystemPrompt: () => [...(resources?.appendSystemPrompt ?? [])],
		extendResources: () => {},
		reload: async () => {},
	};
};

export const createMemoryAgentEnvironment = (options: {
	readonly workflow: Workflow<unknown>;
	readonly paths: SessionPaths;
	readonly credentials: ProviderCredentials;
}): {
	readonly createAgentSession: CreateAgentSession;
	readonly dispose: () => void;
} => {
	const { workflow, paths } = options;
	const credential = options.credentials[workflow.agent.provider];
	if (credential === undefined)
		throw new BoundaryError({
			code: "provider_not_authenticated",
			message: `Missing programmatic credential for ${workflow.agent.provider}`,
			retryable: false,
			context: { provider: workflow.agent.provider },
		});
	const authStorage = AuthStorage.inMemory({
		[workflow.agent.provider]: { type: "api_key", key: credential.apiKey },
	});
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	const model = configuredModel(modelRegistry, workflow.agent);
	const settingsManager = SettingsManager.inMemory({});
	const resourceLoader = literalResources(workflow.resources);
	return {
		createAgentSession: async (perRun) => {
			const cwd = perRun.cwd ?? paths.cwd;
			const services: AgentSessionServices = {
				cwd,
				agentDir: paths.agentDir,
				authStorage,
				settingsManager,
				modelRegistry,
				resourceLoader,
				diagnostics: [],
			};
			return createAgentSessionFromServices({
				services,
				sessionManager: SessionManager.inMemory(cwd),
				sessionStartEvent: { type: "session_start", reason: "startup" },
				model,
				thinkingLevel: workflow.agent.thinking,
				tools: workflow.agent.tools,
				excludeTools: workflow.agent.excludeTools,
				noTools: resolveNoTools(workflow.agent.noTools),
				customTools: perRun.customTools,
			} as Parameters<typeof createAgentSessionFromServices>[0]);
		},
		dispose: () => authStorage.remove(workflow.agent.provider),
	};
};
