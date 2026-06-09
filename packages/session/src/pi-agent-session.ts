import { join, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import type { CreateAgentSession } from "./agent-session-client.js";
import type { PlotPaths } from "./plot-paths.js";
import type {
	AgentToolMode,
	WorkflowAgentConfig,
	WorkflowDefinition,
	WorkflowResourcesConfig,
} from "./workflow.js";

export interface PlotAgentSessionFactoryOptions {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
}

const toNoTools = (mode: AgentToolMode | undefined) => {
	if (mode === undefined || mode === false) return undefined;
	if (mode === true) return "all" as const;
	return mode;
};

const workflowPaths = (
	paths: PlotPaths,
	values: readonly string[] | undefined,
) => (values ?? []).map((value) => resolve(paths.cwd, value));

const withDefaultResourcePath = (
	defaultPath: string,
	paths: PlotPaths,
	values: readonly string[] | undefined,
) => [defaultPath, ...workflowPaths(paths, values)];

const findConfiguredModel = (
	modelRegistry: ModelRegistry,
	agent: WorkflowAgentConfig | undefined,
) => {
	if (agent?.provider === undefined || agent.model === undefined)
		return undefined;
	return modelRegistry.find(agent.provider, agent.model);
};

const createSettingsManager = (
	paths: PlotPaths,
	agent: WorkflowAgentConfig | undefined,
) =>
	SettingsManager.create(paths.cwd, paths.agentDir, {
		projectTrusted: agent?.allowProjectConfig ?? false,
	});

const resourceOptions = (
	paths: PlotPaths,
	resources: WorkflowResourcesConfig | undefined,
) => ({
	additionalExtensionPaths: withDefaultResourcePath(
		paths.extensionsDir,
		paths,
		resources?.extensions,
	),
	additionalSkillPaths: withDefaultResourcePath(
		paths.skillsDir,
		paths,
		resources?.skills,
	),
	additionalPromptTemplatePaths: withDefaultResourcePath(
		paths.promptsDir,
		paths,
		resources?.prompts,
	),
	additionalThemePaths: withDefaultResourcePath(
		paths.themesDir,
		paths,
		resources?.themes,
	),
	noContextFiles: resources?.contextFiles === false,
});

export const makePlotCreateAgentSession = (
	options: PlotAgentSessionFactoryOptions,
): CreateAgentSession => {
	const { workflow, paths } = options;
	return async (
		request?: CreateAgentSessionOptions,
	): Promise<CreateAgentSessionResult> => {
		const agent = workflow.runtime.agent;
		const resources = workflow.runtime.resources;
		const authStorage =
			request?.authStorage ??
			AuthStorage.create(join(paths.agentDir, "auth.json"));
		const settingsManager =
			request?.settingsManager ?? createSettingsManager(paths, agent);
		const modelRegistry =
			request?.modelRegistry ??
			ModelRegistry.create(authStorage, join(paths.agentDir, "models.json"));
		const services = await createAgentSessionServices({
			cwd: request?.cwd ?? paths.cwd,
			agentDir: request?.agentDir ?? paths.agentDir,
			authStorage,
			settingsManager,
			modelRegistry,
			resourceLoaderOptions: resourceOptions(paths, resources),
			resourceLoaderReloadOptions: {
				resolveProjectTrust: async () => agent?.allowProjectConfig ?? false,
			},
		});
		const sessionManager =
			request?.sessionManager ??
			SessionManager.create(services.cwd, paths.sessionDir);
		const model = request?.model ?? findConfiguredModel(modelRegistry, agent);
		const thinkingLevel = request?.thinkingLevel ?? agent?.thinking;
		const tools = request?.tools ?? agent?.tools;
		const excludeTools = request?.excludeTools ?? agent?.excludeTools;
		const noTools = request?.noTools ?? toNoTools(agent?.noTools);
		return createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "startup" },
			...(model === undefined ? {} : { model }),
			...(thinkingLevel === undefined ? {} : { thinkingLevel }),
			...(tools === undefined ? {} : { tools: [...tools] }),
			...(excludeTools === undefined
				? {}
				: { excludeTools: [...excludeTools] }),
			...(noTools === undefined ? {} : { noTools }),
			...(request?.customTools === undefined
				? {}
				: { customTools: request.customTools }),
		});
	};
};
