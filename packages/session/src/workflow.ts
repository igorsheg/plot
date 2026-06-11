import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { withWideEvent } from "@plot/common/observability";
import { TaggedError } from "better-result";
import { parse as parseYaml } from "yaml";

export class PlotWorkflowError extends TaggedError("PlotWorkflowError")<{
	readonly phase: "read" | "parse";
	readonly message: string;
	readonly path?: string;
}>() {}
export type AgentToolMode = boolean | "all" | "builtin";
export interface WorkflowAgentConfig {
	readonly provider?: string | undefined;
	readonly model?: string | undefined;
	readonly thinking?:
		| "off"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| "xhigh"
		| undefined;
	readonly tools?: readonly string[] | undefined;
	readonly excludeTools?: readonly string[] | undefined;
	readonly noTools?: AgentToolMode | undefined;
	readonly allowProjectConfig?: boolean | undefined;
}
export interface WorkflowPlotConfig {
	readonly tickIntervalMs?: number | undefined;
	readonly maxRunDurationMs?: number | undefined;
	readonly queueCapacity?: number | undefined;
	readonly eventCapacity?: number | undefined;
	readonly replayCapacity?: number | undefined;
}
export interface WorkflowResourcesConfig {
	readonly skills?: readonly string[] | undefined;
	readonly prompts?: readonly string[] | undefined;
	readonly contextFiles?: boolean | undefined;
	readonly systemPrompt?: string | undefined;
	readonly appendSystemPrompt?: readonly string[] | undefined;
}
export interface WorkflowExtensionConfig {
	readonly source: string;
	readonly maxConcurrentRuns?: number | undefined;
	readonly config?: unknown;
}
export interface WorkflowRuntimeConfig {
	readonly name?: string;
	readonly plot?: WorkflowPlotConfig;
	readonly agent?: WorkflowAgentConfig;
	readonly resources?: WorkflowResourcesConfig;
	readonly extension?: WorkflowExtensionConfig;
}
export interface WorkflowDefinition {
	readonly config: Record<string, unknown>;
	readonly runtime: WorkflowRuntimeConfig;
	readonly prompt: string;
	readonly path?: string;
}
export interface WorkflowFileSystemShape {
	readonly readFileString: (path: string) => Promise<string>;
}
export type WorkflowFileSystem = WorkflowFileSystemShape;
export const WorkflowFileSystem = Symbol("WorkflowFileSystem");
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
export const nodeWorkflowFileSystemLayer: WorkflowFileSystemShape = {
	readFileString: (path) =>
		withWideEvent("workflow.read", { path }, async () => {
			try {
				return await readFile(path, "utf8");
			} catch (error) {
				throw new PlotWorkflowError({
					phase: "read",
					path,
					message: errorMessage(error),
				});
			}
		}),
};
const frontMatterPattern = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const parseConfig = (
	frontMatter: string,
	path: string | undefined,
): Record<string, unknown> => {
	try {
		const parsed = frontMatter.trim() === "" ? {} : parseYaml(frontMatter);
		if (parsed === null) return {};
		if (typeof parsed !== "object" || Array.isArray(parsed))
			throw new Error("workflow front matter must be an object");
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new PlotWorkflowError({
			phase: "parse",
			message: errorMessage(error),
			...(path === undefined ? {} : { path }),
		});
	}
};
const stringArray = (
	value: unknown,
	field: string,
): readonly string[] | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.some((x) => typeof x !== "string"))
		throw new Error(`${field} must be string[]`);
	return value;
};
const object = (value: unknown, field: string): Record<string, unknown> => {
	if (value === undefined) return {};
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error(`${field} must be object`);
	return value as Record<string, unknown>;
};
const decodeRuntimeConfig = (
	config: Record<string, unknown>,
	path?: string,
): WorkflowRuntimeConfig => {
	try {
		const runtime = object(config["runtime"] ?? config, "runtime");
		const agent =
			runtime["agent"] === undefined
				? undefined
				: object(runtime["agent"], "agent");
		const plot =
			runtime["plot"] === undefined
				? undefined
				: object(runtime["plot"], "plot");
		const resources =
			runtime["resources"] === undefined
				? undefined
				: object(runtime["resources"], "resources");
		const extension =
			runtime["extension"] === undefined
				? undefined
				: object(runtime["extension"], "extension");
		return {
			...(typeof runtime["name"] === "string" ? { name: runtime["name"] } : {}),
			...(plot
				? {
						plot: {
							tickIntervalMs: plot["tickIntervalMs"] as number | undefined,
							maxRunDurationMs: plot["maxRunDurationMs"] as number | undefined,
							queueCapacity: plot["queueCapacity"] as number | undefined,
							eventCapacity: plot["eventCapacity"] as number | undefined,
							replayCapacity: plot["replayCapacity"] as number | undefined,
						},
					}
				: {}),
			...(agent
				? {
						agent: {
							provider: agent["provider"] as string | undefined,
							model: agent["model"] as string | undefined,
							thinking: agent["thinking"] as WorkflowAgentConfig["thinking"],
							tools: stringArray(agent["tools"], "tools"),
							excludeTools: stringArray(agent["excludeTools"], "excludeTools"),
							noTools: agent["noTools"] as AgentToolMode | undefined,
							allowProjectConfig: agent["allowProjectConfig"] as
								| boolean
								| undefined,
						},
					}
				: {}),
			...(resources
				? {
						resources: {
							skills: stringArray(resources["skills"], "skills"),
							prompts: stringArray(resources["prompts"], "prompts"),
							contextFiles: resources["contextFiles"] as boolean | undefined,
							systemPrompt: resources["systemPrompt"] as string | undefined,
							appendSystemPrompt: stringArray(
								resources["appendSystemPrompt"],
								"appendSystemPrompt",
							),
						},
					}
				: {}),
			...(extension
				? {
						extension: {
							source: String(extension["source"]),
							maxConcurrentRuns: extension["maxConcurrentRuns"] as
								| number
								| undefined,
							config: extension["config"],
						},
					}
				: {}),
		};
	} catch (error) {
		throw new PlotWorkflowError({
			phase: "parse",
			message: errorMessage(error),
			...(path === undefined ? {} : { path }),
		});
	}
};
export const parseWorkflowText = (
	text: string,
	path?: string,
): Promise<WorkflowDefinition> =>
	withWideEvent(
		"workflow.parse",
		{ ...(path === undefined ? {} : { path }), bytes: text.length },
		async () => {
			const match = frontMatterPattern.exec(text);
			const frontMatter = match?.[1] ?? "";
			const prompt = match ? text.slice(match[0].length).trim() : text.trim();
			const config = parseConfig(frontMatter, path);
			const runtime = decodeRuntimeConfig(config, path);
			return {
				config,
				runtime,
				prompt,
				...(path === undefined ? {} : { path }),
			};
		},
	);
export const DEFAULT_WORKFLOW_PATH = "WORKFLOW.md";
export interface WorkflowDiscoveryOptions {
	readonly cwd: string;
	readonly workflowPath?: string;
}
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
	fileSystem: WorkflowFileSystemShape = nodeWorkflowFileSystemLayer,
): Promise<WorkflowDefinition> =>
	withWideEvent("workflow.load", { path }, async () =>
		parseWorkflowText(await fileSystem.readFileString(path), path),
	);
export const loadWorkflowFromNode = (
	path = DEFAULT_WORKFLOW_PATH,
): Promise<WorkflowDefinition> =>
	loadWorkflow(path, nodeWorkflowFileSystemLayer);
export const loadDiscoveredWorkflowFromNode = (
	options: WorkflowDiscoveryOptions,
): Promise<WorkflowDefinition> =>
	loadWorkflowFromNode(resolveWorkflowPath(options));
