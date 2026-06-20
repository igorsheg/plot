import { join, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type {
	CreateAgentSession,
	CreateAgentSessionOptions,
	CreateAgentSessionResult,
} from "./agent-session-types.js";
import type { PlotPaths } from "./plot-paths.js";
import {
	loadPlotSettings,
	plotSettingsForAgentSession,
} from "./plot-settings.js";
import type {
	AgentToolMode,
	WorkflowAgentConfig,
	WorkflowDefinition,
	WorkflowResourcesConfig,
} from "./workflow.js";

export interface PlotAgentSessionCliOverrides {
	readonly provider?: string;
	readonly model?: string;
	readonly apiKey?: string;
	readonly thinking?: WorkflowAgentConfig["thinking"];
	readonly tools?: readonly string[];
	readonly excludeTools?: readonly string[];
	readonly noTools?: AgentToolMode;
	readonly allowProjectConfig?: boolean;
	readonly skills?: readonly string[];
	readonly prompts?: readonly string[];
	readonly noSkills?: boolean;
	readonly noPromptTemplates?: boolean;
	readonly contextFiles?: boolean;
	readonly systemPrompt?: string;
	readonly appendSystemPrompt?: readonly string[];
}

export interface PlotAgentSessionFactoryOptions {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly overrides?: PlotAgentSessionCliOverrides;
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

const resolvedAgent = (
	workflow: WorkflowDefinition,
	overrides: PlotAgentSessionCliOverrides | undefined,
): WorkflowAgentConfig => {
	const modelSelector = overrides?.model;
	const slashIndex = modelSelector?.indexOf("/") ?? -1;
	const providerFromModel =
		slashIndex > 0 ? modelSelector?.slice(0, slashIndex) : undefined;
	const modelFromSelector =
		slashIndex > 0 ? modelSelector?.slice(slashIndex + 1) : modelSelector;
	const provider = overrides?.provider ?? providerFromModel;
	return {
		...workflow.runtime.agent,
		...(provider === undefined ? {} : { provider }),
		...(modelFromSelector === undefined ? {} : { model: modelFromSelector }),
		...(overrides?.thinking === undefined
			? {}
			: { thinking: overrides.thinking }),
		...(overrides?.tools === undefined ? {} : { tools: [...overrides.tools] }),
		...(overrides?.excludeTools === undefined
			? {}
			: { excludeTools: [...overrides.excludeTools] }),
		...(overrides?.noTools === undefined ? {} : { noTools: overrides.noTools }),
		...(overrides?.allowProjectConfig === undefined
			? {}
			: { allowProjectConfig: overrides.allowProjectConfig }),
	};
};

const resolvedResources = (
	workflow: WorkflowDefinition,
	overrides: PlotAgentSessionCliOverrides | undefined,
): WorkflowResourcesConfig => ({
	...workflow.runtime.resources,
	...(overrides?.skills === undefined ? {} : { skills: [...overrides.skills] }),
	...(overrides?.prompts === undefined
		? {}
		: { prompts: [...overrides.prompts] }),
	...(overrides?.contextFiles === undefined
		? {}
		: { contextFiles: overrides.contextFiles }),
	...(overrides?.systemPrompt === undefined
		? {}
		: { systemPrompt: overrides.systemPrompt }),
	...(overrides?.appendSystemPrompt === undefined
		? {}
		: { appendSystemPrompt: [...overrides.appendSystemPrompt] }),
});

const findConfiguredModel = (
	modelRegistry: ModelRegistry,
	agent: WorkflowAgentConfig,
) => {
	if (agent.provider === undefined || agent.model === undefined)
		return undefined;
	return modelRegistry.find(agent.provider, agent.model);
};

const createSettingsManager = async (paths: PlotPaths) =>
	SettingsManager.inMemory(
		plotSettingsForAgentSession(await loadPlotSettings(paths)),
	);

const resourceOptions = (
	paths: PlotPaths,
	resources: WorkflowResourcesConfig,
	overrides: PlotAgentSessionCliOverrides | undefined,
) => ({
	additionalSkillPaths: withDefaultResourcePath(
		paths.skillsDir,
		paths,
		resources.skills,
	),
	additionalPromptTemplatePaths: withDefaultResourcePath(
		paths.promptsDir,
		paths,
		resources.prompts,
	),
	noExtensions: true,
	noThemes: true,
	noSkills: overrides?.noSkills ?? false,
	noPromptTemplates: overrides?.noPromptTemplates ?? false,
	noContextFiles: resources.contextFiles === false,
	...(resources.systemPrompt === undefined
		? {}
		: { systemPrompt: resources.systemPrompt }),
	...(resources.appendSystemPrompt === undefined
		? {}
		: { appendSystemPrompt: [...resources.appendSystemPrompt] }),
});

export const makePlotCreateAgentSession = (
	options: PlotAgentSessionFactoryOptions,
): CreateAgentSession => {
	const { workflow, paths, overrides } = options;
	return async (
		request?: CreateAgentSessionOptions,
	): Promise<CreateAgentSessionResult> => {
		const agent = resolvedAgent(workflow, overrides);
		const resources = resolvedResources(workflow, overrides);
		const authStorage =
			request?.authStorage ??
			AuthStorage.create(join(paths.agentDir, "auth.json"));
		if (overrides?.apiKey !== undefined) {
			if (agent.provider === undefined) {
				throw new Error(
					"--api-key requires --provider or --model provider/model",
				);
			}
			authStorage.setRuntimeApiKey(agent.provider, overrides.apiKey);
		}
		const settingsManager =
			request?.settingsManager ?? (await createSettingsManager(paths));
		const modelRegistry =
			request?.modelRegistry ??
			ModelRegistry.create(authStorage, join(paths.agentDir, "models.json"));
		const services = await createAgentSessionServices({
			cwd: request?.cwd ?? paths.cwd,
			agentDir: request?.agentDir ?? paths.agentDir,
			authStorage,
			settingsManager,
			modelRegistry,
			resourceLoaderOptions: resourceOptions(paths, resources, overrides),
			resourceLoaderReloadOptions: {
				resolveProjectTrust: async () => agent.allowProjectConfig ?? false,
			},
		});
		const sessionManager =
			request?.sessionManager ??
			SessionManager.create(services.cwd, paths.sessionDir);
		const model = request?.model ?? findConfiguredModel(modelRegistry, agent);
		const thinkingLevel = request?.thinkingLevel ?? agent.thinking;
		const tools = request?.tools ?? agent.tools;
		const excludeTools = request?.excludeTools ?? agent.excludeTools;
		const noTools = request?.noTools ?? toNoTools(agent.noTools);
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
