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
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { errorMessage, hasErrnoCode } from "@plot/common/primitives";
import { Schema } from "effect";
import type { CreatePiAgentSession } from "./pi-runner.js";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import type { WorkflowRuntimeConfig } from "./workflow-config.js";
import { NonEmptyString, decodeBoundary, optional } from "./schema.js";

type AgentConfig = NonNullable<WorkflowRuntimeConfig["agent"]>;
type ResourcesConfig = NonNullable<WorkflowRuntimeConfig["resources"]>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type AgentToolMode = NonNullable<AgentConfig["noTools"]>;

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

const settingsSchema = Schema.Struct({
	defaultProvider: optional(NonEmptyString),
	defaultModel: optional(NonEmptyString),
	defaultThinkingLevel: optional(
		Schema.Literals(["off", "minimal", "low", "medium", "high", "xhigh"]),
	),
});

type AgentSettings = typeof settingsSchema.Type;

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
	const globalSettings = decodeBoundary(settingsSchema, global);
	const projectSettings = decodeBoundary(settingsSchema, project);
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
	return {
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
	};
};

export const makeCreatePiAgentSession = (
	options: AgentSessionFactoryOptions,
): CreatePiAgentSession => {
	const { workflow, paths, overrides } = options;
	return async (request?: CreateAgentSessionOptions) => {
		const agent = resolvedAgent(workflow, overrides);
		const resources = resolvedResources(workflow, overrides);
		const authStorage =
			request?.authStorage ??
			AuthStorage.create(join(paths.agentDir, "auth.json"));
		if (overrides?.apiKey !== undefined) {
			if (agent.provider === undefined)
				throw new Error(
					"--api-key requires --provider or --model provider/model",
				);
			authStorage.setRuntimeApiKey(agent.provider, overrides.apiKey);
		}
		const settingsManager =
			request?.settingsManager ??
			SettingsManager.inMemory(settingsForPi(await loadAgentSettings(paths)));
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
		const noTools = request?.noTools ?? toPiNoTools(agent.noTools);
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
