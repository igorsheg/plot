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
import { errorMessage, hasErrnoCode } from "@plot/common/primitives";
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
	readonly overrides?: AgentSessionOverrides | undefined;
}

interface AgentSettings {
	readonly defaultProvider?: string;
	readonly defaultModel?: string;
	readonly defaultThinkingLevel?: NonNullable<AgentConfig["thinking"]>;
}

const thinkingLevels = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const parseSettings = (value: unknown): AgentSettings => {
	if (value === undefined || value === null) return {};
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error(`settings must be a JSON object`);
	const input = value as Record<string, unknown>;
	const settings: {
		defaultProvider?: string;
		defaultModel?: string;
		defaultThinkingLevel?: NonNullable<AgentConfig["thinking"]>;
	} = {};
	for (const key of ["defaultProvider", "defaultModel"] as const) {
		const field = input[key];
		if (field === undefined) continue;
		if (typeof field !== "string") throw new Error(`${key} must be a string`);
		if (field.length > 0) settings[key] = field;
	}
	const thinking = input["defaultThinkingLevel"];
	if (thinking !== undefined) {
		if (typeof thinking !== "string" || !thinkingLevels.has(thinking))
			throw new Error(`defaultThinkingLevel is not recognized`);
		settings.defaultThinkingLevel = thinking as NonNullable<
			AgentConfig["thinking"]
		>;
	}
	return settings;
};

const readSettings = async (path: string): Promise<AgentSettings> => {
	try {
		return parseSettings(JSON.parse(await readFile(path, "utf8")));
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
		readSettings(files.globalSettingsPath),
		readSettings(files.projectSettingsPath),
	]);
	return { ...global, ...project };
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
	const configured = workflow.runtime.agent ?? {};
	const selector = splitModelSelector(overrides?.model);
	return {
		provider: overrides?.provider ?? selector.provider ?? configured.provider,
		model: selector.model ?? configured.model,
		thinking: overrides?.thinking ?? configured.thinking,
		tools: overrides?.tools ?? configured.tools,
		excludeTools: overrides?.excludeTools ?? configured.excludeTools,
		noTools: overrides?.noTools ?? configured.noTools,
		allowProjectConfig:
			overrides?.allowProjectConfig ?? configured.allowProjectConfig,
		maxTurns: configured.maxTurns,
	} as AgentConfig;
};

const resolvedResources = (
	workflow: WorkflowDefinition,
	overrides: AgentSessionOverrides | undefined,
): ResourcesConfig => {
	const configured = workflow.runtime.resources ?? {};
	return {
		skills: overrides?.skills ?? configured.skills,
		prompts: overrides?.prompts ?? configured.prompts,
		contextFiles: overrides?.contextFiles ?? configured.contextFiles,
		systemPrompt: overrides?.systemPrompt ?? configured.systemPrompt,
		appendSystemPrompt:
			overrides?.appendSystemPrompt ?? configured.appendSystemPrompt,
	} as ResourcesConfig;
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
		systemPrompt: resources.systemPrompt,
		appendSystemPrompt: resources.appendSystemPrompt,
	} as ResourceLoaderOptions;
};

export const makeCreatePiAgentSession = (
	options: AgentSessionFactoryOptions,
): CreatePiAgentSession => {
	const { workflow, paths, overrides } = options;
	return async (perRun?: PiAgentSessionRunOptions) => {
		const agent = resolvedAgent(workflow, overrides);
		const resources = resolvedResources(workflow, overrides);
		const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
		if (overrides?.apiKey) {
			if (agent.provider === undefined)
				throw new Error(
					"--api-key requires --provider or --model provider/model",
				);
			authStorage.setRuntimeApiKey(agent.provider, overrides.apiKey);
		}
		const settingsManager = SettingsManager.inMemory({
			...(await loadAgentSettings(paths)),
		});
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
		return createAgentSessionFromServices({
			services,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "startup" },
			model: findConfiguredModel(modelRegistry, agent),
			thinkingLevel: agent.thinking,
			tools: agent.tools,
			excludeTools: agent.excludeTools,
			noTools: toPiNoTools(agent.noTools),
			customTools: perRun?.customTools,
		} as Parameters<typeof createAgentSessionFromServices>[0]);
	};
};
