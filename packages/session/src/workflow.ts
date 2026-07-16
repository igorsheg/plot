import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
	BoundaryError,
	type BoundaryErrorRecord,
} from "@plot/common/boundary-error";
import { errorMessage } from "@plot/common/primitives";
import type {
	AgentConfig,
	AgentThinkingLevel,
	WorkflowConfig,
	WorkflowExtensionOptions,
	WorkflowResources,
} from "@plot/sdk";

export class WorkflowBoundaryError extends BoundaryError {
	override readonly name = "WorkflowBoundaryError";
	readonly phase: "read" | "parse" | "prepare";
	readonly path?: string | undefined;

	constructor(input: {
		readonly phase: "read" | "parse" | "prepare";
		readonly message: string;
		readonly path?: string | undefined;
	}) {
		const context: Record<string, string> = { phase: input.phase };
		if (input.path !== undefined) context["path"] = input.path;
		super({
			code: "workflow_invalid",
			message: input.message,
			retryable: false,
			context,
		});
		this.phase = input.phase;
		this.path = input.path;
	}
}

export const workflowBoundaryErrorFromRecord = (
	record: BoundaryErrorRecord,
): WorkflowBoundaryError | undefined => {
	const phase = record.context?.["phase"];
	if (
		record.code !== "workflow_invalid" ||
		(phase !== "read" && phase !== "parse" && phase !== "prepare")
	)
		return;
	const path = record.context?.["path"];
	const input: {
		phase: "read" | "parse" | "prepare";
		message: string;
		path?: string;
	} = { phase, message: record.message };
	if (typeof path === "string") input.path = path;
	return new WorkflowBoundaryError(input);
};

export interface LoadedWorkflow {
	readonly config: Record<string, unknown>;
	readonly runtime: WorkflowFileConfig;
	readonly prompt: string;
	readonly path?: string | undefined;
}

export interface WorkflowFileSystem {
	readonly readFileString: (path: string) => Promise<string>;
}

export interface WorkflowDiscoveryOptions {
	readonly cwd: string;
	readonly workflowPath?: string | undefined;
}

export const DEFAULT_WORKFLOW_PATH = "WORKFLOW.md";

const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const workflowKeys = [
	"name",
	"plot",
	"agent",
	"resources",
	"extension",
] as const;

export interface WorkflowResourcesConfig extends WorkflowResources {
	readonly skills?: readonly string[];
	readonly prompts?: readonly string[];
	readonly contextFiles?: boolean;
}

export interface WorkflowFileExtension extends WorkflowExtensionOptions {
	readonly source: string;
}

export interface WorkflowFileConfig {
	readonly name?: string;
	readonly plot?: WorkflowConfig;
	readonly agent: AgentConfig;
	readonly resources?: WorkflowResourcesConfig;
	readonly extension: WorkflowFileExtension;
}

type Mutable<Value> = {
	-readonly [Key in keyof Value]: Value[Key];
};

const mapping = (value: unknown, name: string): Record<string, unknown> => {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${name} must be a mapping`);
	return value as Record<string, unknown>;
};

const fields = (
	value: unknown,
	name: string,
	allowed: readonly string[],
): Record<string, unknown> => {
	const record = mapping(value, name);
	for (const key of Object.keys(record))
		if (!allowed.includes(key))
			throw new Error(`${name}.${key} is not recognized`);
	return record;
};

const string = (value: unknown, name: string, empty = false): string => {
	if (typeof value !== "string" || (!empty && value.length === 0))
		throw new Error(
			`${name} must be ${empty ? "a string" : "a non-empty string"}`,
		);
	return value;
};

const positiveInteger = (value: unknown, name: string): number => {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
};

const boolean = (value: unknown, name: string): boolean => {
	if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
	return value;
};

const strings = (value: unknown, name: string): readonly string[] => {
	if (!Array.isArray(value)) throw new Error(`${name} must be a list`);
	return value.map((item, index) => string(item, `${name}[${index}]`));
};

const decodeSchedulingConfig = (value: unknown): WorkflowConfig => {
	const keys = [
		"tickIntervalMs",
		"maxRunDurationMs",
		"stallTimeoutMs",
	] as const;
	const record = fields(value, "plot", keys);
	return Object.fromEntries(
		keys.flatMap((key) =>
			record[key] === undefined
				? []
				: [[key, positiveInteger(record[key], `plot.${key}`)]],
		),
	);
};

const thinkingLevels = new Set<AgentThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const decodeAgent = (value: unknown): AgentConfig => {
	const record = fields(value, "agent", [
		"provider",
		"model",
		"thinking",
		"tools",
		"excludeTools",
		"noTools",
		"allowProjectConfig",
		"maxTurns",
	]);
	const config: Mutable<AgentConfig> = {
		provider: string(record["provider"], "agent.provider"),
		model: string(record["model"], "agent.model"),
	};
	if (record["thinking"] !== undefined) {
		const thinking = string(record["thinking"], "agent.thinking");
		if (!thinkingLevels.has(thinking as AgentThinkingLevel))
			throw new Error(`agent.thinking is not recognized`);
		config.thinking = thinking as AgentThinkingLevel;
	}
	if (record["tools"] !== undefined)
		config.tools = strings(record["tools"], "agent.tools");
	if (record["excludeTools"] !== undefined)
		config.excludeTools = strings(record["excludeTools"], "agent.excludeTools");
	if (record["noTools"] !== undefined) {
		const mode = record["noTools"];
		if (mode !== true && mode !== false && mode !== "all" && mode !== "builtin")
			throw new Error(`agent.noTools is not recognized`);
		config.noTools = mode;
	}
	if (record["allowProjectConfig"] !== undefined)
		config.allowProjectConfig = boolean(
			record["allowProjectConfig"],
			"agent.allowProjectConfig",
		);
	if (record["maxTurns"] !== undefined)
		config.maxTurns = positiveInteger(record["maxTurns"], "agent.maxTurns");
	return config;
};

const decodeResources = (value: unknown): WorkflowResourcesConfig => {
	const record = fields(value, "resources", [
		"skills",
		"prompts",
		"contextFiles",
		"systemPrompt",
		"appendSystemPrompt",
	]);
	const config: Mutable<WorkflowResourcesConfig> = {};
	if (record["skills"] !== undefined)
		config.skills = strings(record["skills"], "resources.skills");
	if (record["prompts"] !== undefined)
		config.prompts = strings(record["prompts"], "resources.prompts");
	if (record["contextFiles"] !== undefined)
		config.contextFiles = boolean(
			record["contextFiles"],
			"resources.contextFiles",
		);
	if (record["systemPrompt"] !== undefined)
		config.systemPrompt = string(
			record["systemPrompt"],
			"resources.systemPrompt",
			true,
		);
	if (record["appendSystemPrompt"] !== undefined)
		config.appendSystemPrompt = strings(
			record["appendSystemPrompt"],
			"resources.appendSystemPrompt",
		);
	return config;
};

const decodeExtension = (value: unknown): WorkflowFileExtension => {
	const record = fields(value, "extension", [
		"source",
		"maxConcurrentRuns",
		"config",
	]);
	const config: Mutable<WorkflowFileExtension> = {
		source: string(record["source"], "extension.source"),
	};
	if (record["maxConcurrentRuns"] !== undefined)
		config.maxConcurrentRuns = positiveInteger(
			record["maxConcurrentRuns"],
			"extension.maxConcurrentRuns",
		);
	if (record["config"] !== undefined) config.config = record["config"];
	return config;
};

export const decodeWorkflowFileConfig = (
	value: Record<string, unknown>,
): WorkflowFileConfig => {
	const record = fields(value, "WORKFLOW", workflowKeys);
	let config: Mutable<WorkflowFileConfig>;
	if (record["extension"] === undefined)
		throw new Error(
			"WORKFLOW.md requires an extension with at least one Source.",
		);
	if (record["agent"] === undefined)
		throw new Error("WORKFLOW.md requires agent.provider and agent.model.");
	config = {
		agent: decodeAgent(record["agent"]),
		extension: decodeExtension(record["extension"]),
	};
	if (record["name"] !== undefined)
		config.name = string(record["name"], "name");
	if (record["plot"] !== undefined)
		config.plot = decodeSchedulingConfig(record["plot"]);
	if (record["resources"] !== undefined)
		config.resources = decodeResources(record["resources"]);
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
	let parsed: unknown;
	try {
		parsed = frontMatter.trim() === "" ? {} : parseYaml(frontMatter);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "parse",
			path,
			message: errorMessage(error),
		});
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new WorkflowBoundaryError({
			phase: "parse",
			path,
			message: "workflow front matter must be a YAML mapping",
		});
	return parsed as Record<string, unknown>;
};

export const parseWorkflowText = (
	text: string,
	path?: string,
): LoadedWorkflow => {
	const match = frontMatterPattern.exec(text);
	const config = parseFrontMatter(match?.[1] ?? "", path);
	let runtime: WorkflowFileConfig;
	try {
		const runtimeConfig = Object.fromEntries(
			workflowKeys.flatMap((key) =>
				config[key] === undefined ? [] : [[key, config[key]]],
			),
		);
		runtime = decodeWorkflowFileConfig(runtimeConfig);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "parse",
			path,
			message: errorMessage(error),
		});
	}
	return {
		config,
		runtime,
		prompt: (match ? text.slice(match[0].length) : text).trim(),
		path,
	};
};

export const resolveWorkflowPath = (
	options: WorkflowDiscoveryOptions,
): string => {
	const path = options.workflowPath ?? DEFAULT_WORKFLOW_PATH;
	return isAbsolute(path) ? path : resolve(options.cwd, path);
};

export const loadWorkflow = async (
	path = DEFAULT_WORKFLOW_PATH,
	fileSystem: WorkflowFileSystem = nodeFileSystem,
): Promise<LoadedWorkflow> =>
	parseWorkflowText(await fileSystem.readFileString(path), path);
