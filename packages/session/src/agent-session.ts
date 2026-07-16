import { dirname, join, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { BoundaryError } from "@plot/common/boundary-error";
import type {
	CreateAgentSession,
	AgentSessionRunOptions,
} from "./agent-runner.js";
import type { SessionPaths } from "./paths.js";
import { configuredModel, resolveNoTools } from "./agent-policy.js";
import type { LoadedWorkflow, WorkflowResourcesConfig } from "./workflow.js";

type ResourceLoaderOptions = NonNullable<
	Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]
>;

export interface AgentSessionFactoryOptions {
	readonly workflow: LoadedWorkflow;
	readonly paths: SessionPaths;
}

const workflowDirectory = (workflow: LoadedWorkflow, paths: SessionPaths) =>
	workflow.path === undefined ? paths.cwd : dirname(workflow.path);

const workflowPaths = (
	workflow: LoadedWorkflow,
	paths: SessionPaths,
	values: readonly string[] | undefined,
) =>
	(values ?? []).map((value) =>
		resolve(workflowDirectory(workflow, paths), value),
	);

const resourceOptions = (
	workflow: LoadedWorkflow,
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

export const assertWorkflowAgentReady = (
	workflow: LoadedWorkflow,
	paths: SessionPaths,
): void => {
	const agent = workflow.runtime.agent;
	const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(
		authStorage,
		join(paths.agentDir, "models.json"),
	);
	const model = configuredModel(modelRegistry, agent);
	if (!modelRegistry.hasConfiguredAuth(model))
		throw new BoundaryError({
			code: "provider_not_authenticated",
			message: `Provider ${model.provider} is not authenticated.`,
			retryable: false,
			context: { provider: model.provider },
		});
};

export const makeCreateAgentSession = (
	options: AgentSessionFactoryOptions,
): CreateAgentSession => {
	const { workflow, paths } = options;
	return async (perRun: AgentSessionRunOptions) => {
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
			noTools: resolveNoTools(agent.noTools),
			customTools: perRun.customTools,
		} as Parameters<typeof createAgentSessionFromServices>[0]);
	};
};
