import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { errorMessage, type Mutable } from "@plot/common/primitives";

export class WorkflowBoundaryError extends Error {
	override readonly name = "WorkflowBoundaryError";
	readonly phase: "read" | "parse";
	readonly path?: string;

	constructor(input: {
		readonly phase: "read" | "parse";
		readonly message: string;
		readonly path?: string | undefined;
	}) {
		super(input.message);
		this.phase = input.phase;
		if (input.path !== undefined) this.path = input.path;
	}
}

export interface WorkflowDefinition {
	readonly config: Record<string, unknown>;
	readonly runtime: WorkflowRuntimeConfig;
	readonly prompt: string;
	readonly path?: string;
}

export interface WorkflowFileSystem {
	readonly readFileString: (path: string) => Promise<string>;
}

export interface WorkflowDiscoveryOptions {
	readonly cwd: string;
	readonly workflowPath?: string;
}

export const DEFAULT_WORKFLOW_PATH = "WORKFLOW.md";

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const runtimeKeys = [
	"name",
	"plot",
	"agent",
	"resources",
	"extension",
] as const;

export type WorkflowThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export type WorkflowAgentToolMode = boolean | "all" | "builtin";

export interface WorkflowAgentConfig {
	readonly provider?: string;
	readonly model?: string;
	readonly thinking?: WorkflowThinkingLevel;
	readonly tools?: readonly string[];
	readonly excludeTools?: readonly string[];
	readonly noTools?: WorkflowAgentToolMode;
	readonly allowProjectConfig?: boolean;
	readonly maxTurns?: number;
}

export interface WorkflowPlotConfig {
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
	readonly queueCapacity?: number;
	readonly eventCapacity?: number;
	readonly eventBufferCapacity?: number;
}

export interface WorkflowResourcesConfig {
	readonly skills?: readonly string[];
	readonly prompts?: readonly string[];
	readonly contextFiles?: boolean;
	readonly systemPrompt?: string;
	readonly appendSystemPrompt?: readonly string[];
}

export interface WorkflowExtensionConfig {
	readonly source: string;
	readonly maxConcurrentRuns?: number;
	readonly config?: unknown;
}

export interface WorkflowRuntimeConfig {
	readonly name?: string;
	readonly plot?: WorkflowPlotConfig;
	readonly agent?: WorkflowAgentConfig;
	readonly resources?: WorkflowResourcesConfig;
	readonly extension?: WorkflowExtensionConfig;
}

class FieldError extends Error {}

const fail = (path: string, expected: string): never => {
	throw new FieldError(`${path} ${expected}`);
};

const section = (value: unknown, path: string): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		fail(path, "must be a mapping");
	return value as Record<string, unknown>;
};

const checkKeys = (
	record: Record<string, unknown>,
	path: string,
	allowed: readonly string[],
): void => {
	for (const key of Object.keys(record))
		if (!allowed.includes(key))
			fail(
				`${path}.${key}`,
				`is not a recognized field (expected one of: ${allowed.join(", ")})`,
			);
};

const nonEmptyString = (value: unknown, path: string): string => {
	if (typeof value !== "string" || value.length === 0)
		fail(path, "must be a non-empty string");
	return value as string;
};

const plainString = (value: unknown, path: string): string => {
	if (typeof value !== "string") fail(path, "must be a string");
	return value as string;
};

const boolean = (value: unknown, path: string): boolean => {
	if (typeof value !== "boolean") fail(path, "must be a boolean");
	return value as boolean;
};

const positiveInteger = (value: unknown, path: string): number => {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
		fail(path, "must be a positive integer");
	return value as number;
};

const stringArray = (value: unknown, path: string): readonly string[] => {
	if (!Array.isArray(value)) fail(path, "must be a list of non-empty strings");
	return (value as unknown[]).map((item, index) =>
		nonEmptyString(item, `${path}[${index}]`),
	);
};

const thinkingLevels = new Set([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const parsePlotConfig = (value: unknown, path: string): WorkflowPlotConfig => {
	const record = section(value, path);
	const keys = [
		"tickIntervalMs",
		"maxRunDurationMs",
		"stallTimeoutMs",
		"queueCapacity",
		"eventCapacity",
		"eventBufferCapacity",
	] as const;
	checkKeys(record, path, keys);
	const config: { -readonly [K in keyof WorkflowPlotConfig]?: number } = {};
	for (const key of keys)
		if (record[key] !== undefined)
			config[key] = positiveInteger(record[key], `${path}.${key}`);
	return config;
};

const parseAgentConfig = (
	value: unknown,
	path: string,
): WorkflowAgentConfig => {
	const record = section(value, path);
	checkKeys(record, path, [
		"provider",
		"model",
		"thinking",
		"tools",
		"excludeTools",
		"noTools",
		"allowProjectConfig",
		"maxTurns",
	]);
	const config: {
		provider?: string;
		model?: string;
		thinking?: WorkflowThinkingLevel;
		tools?: readonly string[];
		excludeTools?: readonly string[];
		noTools?: WorkflowAgentToolMode;
		allowProjectConfig?: boolean;
		maxTurns?: number;
	} = {};
	if (record["provider"] !== undefined)
		config.provider = nonEmptyString(record["provider"], `${path}.provider`);
	if (record["model"] !== undefined)
		config.model = nonEmptyString(record["model"], `${path}.model`);
	if (record["thinking"] !== undefined) {
		const thinking = record["thinking"];
		if (typeof thinking !== "string" || !thinkingLevels.has(thinking))
			fail(
				`${path}.thinking`,
				"must be one of: off, minimal, low, medium, high, xhigh",
			);
		config.thinking = thinking as WorkflowThinkingLevel;
	}
	if (record["tools"] !== undefined)
		config.tools = stringArray(record["tools"], `${path}.tools`);
	if (record["excludeTools"] !== undefined)
		config.excludeTools = stringArray(
			record["excludeTools"],
			`${path}.excludeTools`,
		);
	if (record["noTools"] !== undefined) {
		const noTools = record["noTools"];
		if (
			noTools !== true &&
			noTools !== false &&
			noTools !== "all" &&
			noTools !== "builtin"
		)
			fail(`${path}.noTools`, 'must be a boolean, "all", or "builtin"');
		config.noTools = noTools as WorkflowAgentToolMode;
	}
	if (record["allowProjectConfig"] !== undefined)
		config.allowProjectConfig = boolean(
			record["allowProjectConfig"],
			`${path}.allowProjectConfig`,
		);
	if (record["maxTurns"] !== undefined)
		config.maxTurns = positiveInteger(record["maxTurns"], `${path}.maxTurns`);
	return config;
};

const parseResourcesConfig = (
	value: unknown,
	path: string,
): WorkflowResourcesConfig => {
	const record = section(value, path);
	checkKeys(record, path, [
		"skills",
		"prompts",
		"contextFiles",
		"systemPrompt",
		"appendSystemPrompt",
	]);
	const config: {
		skills?: readonly string[];
		prompts?: readonly string[];
		contextFiles?: boolean;
		systemPrompt?: string;
		appendSystemPrompt?: readonly string[];
	} = {};
	if (record["skills"] !== undefined)
		config.skills = stringArray(record["skills"], `${path}.skills`);
	if (record["prompts"] !== undefined)
		config.prompts = stringArray(record["prompts"], `${path}.prompts`);
	if (record["contextFiles"] !== undefined)
		config.contextFiles = boolean(
			record["contextFiles"],
			`${path}.contextFiles`,
		);
	if (record["systemPrompt"] !== undefined)
		config.systemPrompt = plainString(
			record["systemPrompt"],
			`${path}.systemPrompt`,
		);
	if (record["appendSystemPrompt"] !== undefined)
		config.appendSystemPrompt = stringArray(
			record["appendSystemPrompt"],
			`${path}.appendSystemPrompt`,
		);
	return config;
};

const parseExtensionConfig = (
	value: unknown,
	path: string,
): WorkflowExtensionConfig => {
	const record = section(value, path);
	checkKeys(record, path, ["source", "maxConcurrentRuns", "config"]);
	const config: {
		source: string;
		maxConcurrentRuns?: number;
		config?: unknown;
	} = {
		source: nonEmptyString(record["source"], `${path}.source`),
	};
	if (record["maxConcurrentRuns"] !== undefined)
		config.maxConcurrentRuns = positiveInteger(
			record["maxConcurrentRuns"],
			`${path}.maxConcurrentRuns`,
		);
	if (record["config"] !== undefined) config.config = record["config"];
	return config;
};

export const decodeWorkflowRuntimeConfig = (
	value: Record<string, unknown>,
): WorkflowRuntimeConfig => {
	checkKeys(value, "runtime", [
		"name",
		"plot",
		"agent",
		"resources",
		"extension",
	]);
	const config: {
		name?: string;
		plot?: WorkflowPlotConfig;
		agent?: WorkflowAgentConfig;
		resources?: WorkflowResourcesConfig;
		extension?: WorkflowExtensionConfig;
	} = {};
	if (value["name"] !== undefined)
		config.name = nonEmptyString(value["name"], "runtime.name");
	if (value["plot"] !== undefined)
		config.plot = parsePlotConfig(value["plot"], "runtime.plot");
	if (value["agent"] !== undefined)
		config.agent = parseAgentConfig(value["agent"], "runtime.agent");
	if (value["resources"] !== undefined)
		config.resources = parseResourcesConfig(
			value["resources"],
			"runtime.resources",
		);
	if (value["extension"] !== undefined)
		config.extension = parseExtensionConfig(
			value["extension"],
			"runtime.extension",
		);
	return config;
};

const nodeFileSystem: WorkflowFileSystem = {
	readFileString: async (path) => {
		try {
			return await readFile(path, "utf8");
		} catch (error) {
			throw new WorkflowBoundaryError({
				phase: "read",
				path,
				message: errorMessage(error),
			});
		}
	},
};

const parseFrontMatter = (
	frontMatter: string,
	path: string | undefined,
): Record<string, unknown> => {
	try {
		const parsed = frontMatter.trim() === "" ? {} : parseYaml(frontMatter);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			throw new WorkflowBoundaryError({
				phase: "parse",
				path,
				message: "workflow front matter must be a YAML mapping",
			});
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "parse",
			path,
			message: errorMessage(error),
		});
	}
};

const runtimeInputFromConfig = (
	config: Record<string, unknown>,
): Record<string, unknown> => {
	const runtime = config["runtime"];
	if (runtime !== undefined) {
		if (
			typeof runtime !== "object" ||
			runtime === null ||
			Array.isArray(runtime)
		)
			throw new WorkflowBoundaryError({
				phase: "parse",
				message: "runtime must be a mapping",
			});
		return runtime as Record<string, unknown>;
	}
	const input: Record<string, unknown> = {};
	for (const key of runtimeKeys) {
		if (config[key] !== undefined) input[key] = config[key];
	}
	return input;
};

const decodeRuntime = (
	config: Record<string, unknown>,
	path: string | undefined,
): WorkflowRuntimeConfig => {
	try {
		return decodeWorkflowRuntimeConfig(runtimeInputFromConfig(config));
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "parse",
			path,
			message: errorMessage(error),
		});
	}
};

export const parseWorkflowText = (
	text: string,
	path?: string,
): WorkflowDefinition => {
	const match = frontMatterPattern.exec(text);
	const frontMatter = match?.[1] ?? "";
	const prompt = match ? text.slice(match[0].length).trim() : text.trim();
	const config = parseFrontMatter(frontMatter, path);
	const workflow: Mutable<WorkflowDefinition> = {
		config,
		runtime: decodeRuntime(config, path),
		prompt,
	};
	if (path !== undefined) workflow.path = path;
	return workflow;
};

export const resolveWorkflowPath = (
	options: WorkflowDiscoveryOptions,
): string => {
	const workflowPath = options.workflowPath ?? DEFAULT_WORKFLOW_PATH;
	return isAbsolute(workflowPath)
		? workflowPath
		: resolve(options.cwd, workflowPath);
};

export const loadWorkflow = async (
	path = DEFAULT_WORKFLOW_PATH,
	fileSystem: WorkflowFileSystem = nodeFileSystem,
): Promise<WorkflowDefinition> =>
	parseWorkflowText(await fileSystem.readFileString(path), path);

export const loadDiscoveredWorkflow = (
	options: WorkflowDiscoveryOptions,
	fileSystem: WorkflowFileSystem = nodeFileSystem,
): Promise<WorkflowDefinition> =>
	loadWorkflow(resolveWorkflowPath(options), fileSystem);
