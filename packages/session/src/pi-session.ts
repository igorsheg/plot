import { dirname, join, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	CreatePiAgentSession,
	PiAgentSessionRunOptions,
} from "./pi-runner.js";
import type { SessionPaths } from "./paths.js";
import type {
	WorkflowAgentConfig,
	WorkflowDefinition,
	WorkflowResourcesConfig,
} from "./workflow.js";

type AgentToolMode = NonNullable<WorkflowAgentConfig["noTools"]>;
type ResourceLoaderOptions = NonNullable<
	Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]
>;

export interface AgentSessionFactoryOptions {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}

const toPiNoTools = (mode: AgentToolMode | undefined) => {
	if (mode === undefined || mode === false) return undefined;
	if (mode === true) return "all";
	return mode;
};

const workflowDirectory = (workflow: WorkflowDefinition, paths: SessionPaths) =>
	workflow.path === undefined ? paths.cwd : dirname(workflow.path);

const workflowPaths = (
	workflow: WorkflowDefinition,
	paths: SessionPaths,
	values: readonly string[] | undefined,
) =>
	(values ?? []).map((value) =>
		resolve(workflowDirectory(workflow, paths), value),
	);

const resourceOptions = (
	workflow: WorkflowDefinition,
	paths: SessionPaths,
	resources: WorkflowResourcesConfig,
): ResourceLoaderOptions => {
	const options: ResourceLoaderOptions = {
		additionalSkillPaths: [
			paths.skillsDir,
			...workflowPaths(workflow, paths, resources.skills),
		],
		additionalPromptTemplatePaths: [
			paths.promptsDir,
			...workflowPaths(workflow, paths, resources.prompts),
		],
		noExtensions: true,
		noThemes: true,
		noSkills: false,
		noPromptTemplates: false,
		noContextFiles: resources.contextFiles === false,
	};
	if (resources.systemPrompt !== undefined)
		options.systemPrompt = resources.systemPrompt;
	if (resources.appendSystemPrompt !== undefined)
		options.appendSystemPrompt = [...resources.appendSystemPrompt];
	return options;
};

const configuredModel = (
	registry: ModelRegistry,
	agent: WorkflowAgentConfig,
) => {
	const model = registry.find(agent.provider, agent.model);
	if (model === undefined)
		throw new Error(`Model not found: ${agent.provider}/${agent.model}`);
	return model;
};

export const assertWorkflowAgentReady = (
	workflow: WorkflowDefinition,
	paths: SessionPaths,
): void => {
	const agent = workflow.runtime.agent;
	const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(
		authStorage,
		join(paths.agentDir, "models.json"),
	);
	const model = configuredModel(modelRegistry, agent);
	const auth = modelRegistry.getProviderAuthStatus(model.provider);
	if (!auth.configured)
		throw new Error(
			`Provider ${model.provider} is not authenticated; run plot auth login ${model.provider}`,
		);
};

export const makeCreatePiAgentSession = (
	options: AgentSessionFactoryOptions,
): CreatePiAgentSession => {
	const { workflow, paths } = options;
	return async (perRun: PiAgentSessionRunOptions) => {
		const agent = workflow.runtime.agent;
		const resources = workflow.runtime.resources ?? {};
		const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(
			authStorage,
			join(paths.agentDir, "models.json"),
		);
		const model = configuredModel(modelRegistry, agent);
		const services = await createAgentSessionServices({
			cwd: perRun.cwd ?? paths.cwd,
			agentDir: paths.agentDir,
			authStorage,
			settingsManager: SettingsManager.inMemory({}),
			modelRegistry,
			resourceLoaderOptions: resourceOptions(workflow, paths, resources),
			resourceLoaderReloadOptions: {
				resolveProjectTrust: async () => agent.allowProjectConfig ?? false,
			},
		});
		const sessionManager = SessionManager.create(
			services.cwd,
			paths.sessionDir,
		);
		return createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "startup" },
			model,
			thinkingLevel: agent.thinking,
			tools: agent.tools,
			excludeTools: agent.excludeTools,
			noTools: toPiNoTools(agent.noTools),
			customTools: perRun.customTools,
		} as Parameters<typeof createAgentSessionFromServices>[0]);
	};
};
