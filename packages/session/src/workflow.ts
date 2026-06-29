import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { errorMessage } from "@plot/common/primitives";
import {
	decodeWorkflowRuntimeConfig,
	type WorkflowRuntimeConfig,
} from "./workflow-config.js";
import { StringRecord, decodeBoundary } from "./schema.js";

export class WorkflowBoundaryError extends Error {
	override readonly name = "WorkflowBoundaryError";
	readonly phase: "read" | "parse";
	readonly path?: string;

	constructor(input: {
		readonly phase: "read" | "parse";
		readonly message: string;
		readonly path?: string;
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

const configSchema = StringRecord;
const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const runtimeKeys = [
	"name",
	"plot",
	"agent",
	"resources",
	"extension",
] as const;

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
		if (parsed === null) return {};
		return decodeBoundary(configSchema, parsed);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "parse",
			...(path === undefined ? {} : { path }),
			message: errorMessage(error),
		});
	}
};

const runtimeInputFromConfig = (
	config: Record<string, unknown>,
): Record<string, unknown> => {
	const runtime = config["runtime"];
	if (runtime !== undefined) return decodeBoundary(configSchema, runtime);
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
			...(path === undefined ? {} : { path }),
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
	const workflow: WorkflowDefinition = {
		config,
		runtime: decodeRuntime(config, path),
		prompt,
		...(path === undefined ? {} : { path }),
	};
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
