import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	AuthStorage,
	createAgentSessionFromServices,
	createAgentSessionServices,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	errorMessage,
	hasErrnoCode,
	type Mutable,
} from "@plot/common/primitives";
import type {
	CreatePiAgentSession,
	PiAgentSessionRunOptions,
} from "./pi-runner.js";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import type { WorkflowRuntimeConfig } from "./workflow.js";

type AgentConfig = NonNullable<WorkflowRuntimeConfig["agent"]>;
type ResourcesConfig = NonNullable<WorkflowRuntimeConfig["resources"]>;
type AgentToolMode = NonNullable<AgentConfig["noTools"]>;
type ResourceLoaderOptions = NonNullable<
	Parameters<typeof createAgentSessionServices>[0]["resourceLoaderOptions"]
>;

export interface AgentSessionOverrides {
	readonly provider?: string;
	readonly model?: string;
	readonly apiKey?: string;
	readonly thinking?: AgentConfig["thinking"];
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

export interface AgentSessionFactoryOptions {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly overrides?: AgentSessionOverrides;
}

interface AgentSettings {
	readonly defaultProvider?: string;
	readonly defaultModel?: string;
	readonly defaultThinkingLevel?: AgentConfig["thinking"];
}

const thinkingLevels = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const parseAgentSettings = (value: unknown, path: string): AgentSettings => {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error(`failed to read ${path}: settings must be a JSON object`);
	const record = value as Record<string, unknown>;
	const settings: {
		defaultProvider?: string;
		defaultModel?: string;
		defaultThinkingLevel?: AgentConfig["thinking"];
	} = {};
	if ("defaultProvider" in record) {
		if (typeof record["defaultProvider"] !== "string")
			throw new Error(
				`failed to read ${path}: defaultProvider must be a string`,
			);
		if (record["defaultProvider"].length > 0)
			settings.defaultProvider = record["defaultProvider"];
	}
	if ("defaultModel" in record) {
		if (typeof record["defaultModel"] !== "string")
			throw new Error(`failed to read ${path}: defaultModel must be a string`);
		if (record["defaultModel"].length > 0)
			settings.defaultModel = record["defaultModel"];
	}
	const thinking = record["defaultThinkingLevel"];
	if (thinking !== undefined) {
		if (typeof thinking !== "string" || !thinkingLevels.has(thinking))
			throw new Error(
				`failed to read ${path}: defaultThinkingLevel must be one of off, minimal, low, medium, high, xhigh`,
			);
		settings.defaultThinkingLevel = thinking as AgentConfig["thinking"];
	}
	return settings;
};

const readJson = async (path: string): Promise<unknown> => {
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (hasErrnoCode(error, "ENOENT")) return {};
		throw new Error(`failed to read ${path}: ${errorMessage(error)}`, {
			cause: error,
		});
	}
};

const settingsPaths = (paths: SessionPaths) => ({
	globalSettingsPath: resolve(paths.agentDir, "..", "settings.json"),
	projectSettingsPath: join(paths.plotDir, "settings.json"),
});

const loadAgentSettings = async (
	paths: SessionPaths,
): Promise<AgentSettings> => {
	const files = settingsPaths(paths);
	const [global, project] = await Promise.all([
		readJson(files.globalSettingsPath),
		readJson(files.projectSettingsPath),
	]);
	const globalSettings = parseAgentSettings(global, files.globalSettingsPath);
	const projectSettings = parseAgentSettings(
		project,
		files.projectSettingsPath,
	);
	return { ...globalSettings, ...projectSettings };
};

const settingsForPi = (settings: AgentSettings): Record<string, unknown> => {
	const piSettings: Record<string, unknown> = {};
	if (settings.defaultProvider !== undefined)
		piSettings["defaultProvider"] = settings.defaultProvider;
	if (settings.defaultModel !== undefined)
		piSettings["defaultModel"] = settings.defaultModel;
	if (settings.defaultThinkingLevel !== undefined)
		piSettings["defaultThinkingLevel"] = settings.defaultThinkingLevel;
	return piSettings;
};

const toPiNoTools = (mode: AgentToolMode | undefined) => {
	if (mode === undefined || mode === false) return undefined;
	if (mode === true) return "all";
	return mode;
};

const workflowPaths = (
	paths: SessionPaths,
	values: readonly string[] | undefined,
) => (values ?? []).map((value) => resolve(paths.cwd, value));

const withDefaultResourcePath = (
	defaultPath: string,
	paths: SessionPaths,
	values: readonly string[] | undefined,
) => [defaultPath, ...workflowPaths(paths, values)];

const splitModelSelector = (model: string | undefined) => {
	const slashIndex = model?.indexOf("/") ?? -1;
	return slashIndex > 0 && model !== undefined
		? {
				provider: model.slice(0, slashIndex),
				model: model.slice(slashIndex + 1),
			}
		: { model };
};

const resolvedAgent = (
	workflow: WorkflowDefinition,
	overrides: AgentSessionOverrides | undefined,
): AgentConfig => {
	const selector = splitModelSelector(overrides?.model);
	const provider = overrides?.provider ?? selector.provider;
	const agent: Mutable<AgentConfig> = { ...workflow.runtime.agent };
	if (provider !== undefined) agent.provider = provider;
	if (selector.model !== undefined) agent.model = selector.model;
	if (overrides?.thinking !== undefined) agent.thinking = overrides.thinking;
	if (overrides?.tools !== undefined) agent.tools = [...overrides.tools];
	if (overrides?.excludeTools !== undefined)
		agent.excludeTools = [...overrides.excludeTools];
	if (overrides?.noTools !== undefined) agent.noTools = overrides.noTools;
	if (overrides?.allowProjectConfig !== undefined)
		agent.allowProjectConfig = overrides.allowProjectConfig;
	return agent;
};

const resolvedResources = (
	workflow: WorkflowDefinition,
	overrides: AgentSessionOverrides | undefined,
): ResourcesConfig => {
	const resources: Mutable<ResourcesConfig> = { ...workflow.runtime.resources };
	if (overrides?.skills !== undefined) resources.skills = [...overrides.skills];
	if (overrides?.prompts !== undefined)
		resources.prompts = [...overrides.prompts];
	if (overrides?.contextFiles !== undefined)
		resources.contextFiles = overrides.contextFiles;
	if (overrides?.systemPrompt !== undefined)
		resources.systemPrompt = overrides.systemPrompt;
	if (overrides?.appendSystemPrompt !== undefined)
		resources.appendSystemPrompt = [...overrides.appendSystemPrompt];
	return resources;
};

const findConfiguredModel = (
	modelRegistry: ModelRegistry,
	agent: AgentConfig,
) => {
	if (agent.provider === undefined || agent.model === undefined)
		return undefined;
	return modelRegistry.find(agent.provider, agent.model);
};

const resourceOptions = (
	paths: SessionPaths,
	resources: ResourcesConfig,
	overrides: AgentSessionOverrides | undefined,
) => {
	const options: Mutable<ResourceLoaderOptions> = {
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
	};
	if (resources.systemPrompt !== undefined)
		options.systemPrompt = resources.systemPrompt;
	if (resources.appendSystemPrompt !== undefined)
		options.appendSystemPrompt = [...resources.appendSystemPrompt];
	return options;
};

export const makeCreatePiAgentSession = (
	options: AgentSessionFactoryOptions,
): CreatePiAgentSession => {
	const { workflow, paths, overrides } = options;
	return async (perRun?: PiAgentSessionRunOptions) => {
		const agent = resolvedAgent(workflow, overrides);
		const resources = resolvedResources(workflow, overrides);
		const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
		if (overrides?.apiKey !== undefined) {
			if (agent.provider === undefined)
				throw new Error(
					"--api-key requires --provider or --model provider/model",
				);
			authStorage.setRuntimeApiKey(agent.provider, overrides.apiKey);
		}
		const settingsManager = SettingsManager.inMemory(
			settingsForPi(await loadAgentSettings(paths)),
		);
		const modelRegistry = ModelRegistry.create(
			authStorage,
			join(paths.agentDir, "models.json"),
		);
		const services = await createAgentSessionServices({
			cwd: perRun?.cwd ?? paths.cwd,
			agentDir: paths.agentDir,
			authStorage,
			settingsManager,
			modelRegistry,
			resourceLoaderOptions: resourceOptions(paths, resources, overrides),
			resourceLoaderReloadOptions: {
				resolveProjectTrust: async () => agent.allowProjectConfig ?? false,
			},
		});
		const sessionManager = SessionManager.create(
			services.cwd,
			paths.sessionDir,
		);
		const model = findConfiguredModel(modelRegistry, agent);
		const thinkingLevel = agent.thinking;
		const tools = agent.tools;
		const excludeTools = agent.excludeTools;
		const noTools = toPiNoTools(agent.noTools);
		const createOptions: Parameters<typeof createAgentSessionFromServices>[0] =
			{
				services,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "startup" },
			};
		if (model !== undefined) createOptions.model = model;
		if (thinkingLevel !== undefined)
			createOptions.thinkingLevel = thinkingLevel;
		if (tools !== undefined) createOptions.tools = [...tools];
		if (excludeTools !== undefined)
			createOptions.excludeTools = [...excludeTools];
		if (noTools !== undefined) createOptions.noTools = noTools;
		if (perRun?.customTools !== undefined)
			createOptions.customTools = perRun.customTools;
		return createAgentSessionFromServices(createOptions);
	};
};
