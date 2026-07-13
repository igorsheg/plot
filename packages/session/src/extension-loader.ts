import { dirname, isAbsolute, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";
import { isRecord } from "@plot/common/primitives";
import type {
	ExtensionCredentials,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
	PlotJsonSchema,
	PlotToolContext,
	PlotToolDefinition,
	PlotToolExecutionContext,
} from "@plot/sdk";
import * as plotSdk from "@plot/sdk";
import { createExtensionCredentials } from "./extension-credentials.js";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";

export interface LoadedPlotExtensionRuntime {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly credentials: ExtensionCredentials;
	readonly tools: readonly PlotExtensionTool[];
	readonly config: unknown;
}

const importExtensionModule = (source: string): Promise<unknown> =>
	createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: { "plot-ai/sdk": plotSdk },
	}).import(source);

const moduleExtension = (module: unknown): PlotExtension | undefined => {
	if (!isRecord(module)) return;
	const extension = module["default"] ?? module["extension"];
	if (
		!isRecord(extension) ||
		typeof extension["id"] !== "string" ||
		typeof extension["create"] !== "function"
	)
		return;
	return extension as unknown as PlotExtension;
};

const extensionSource = (
	workflow: WorkflowDefinition,
	paths: SessionPaths,
	source: string,
): string =>
	isAbsolute(source)
		? source
		: resolve(workflow.path ? dirname(workflow.path) : paths.cwd, source);

export const loadPlotExtensionRuntimeFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): Promise<LoadedPlotExtensionRuntime> => {
	const extensionConfig = options.workflow.runtime.extension;
	const source = extensionSource(
		options.workflow,
		options.paths,
		extensionConfig.source,
	);
	const extension = moduleExtension(await importExtensionModule(source));
	if (!extension)
		throw new Error(
			"extension module must export a PlotExtension as default or extension",
		);
	const config = extension.parseConfig
		? await extension.parseConfig(extensionConfig.config)
		: extensionConfig.config;
	const tools: PlotExtensionTool[] = [];
	const credentials = createExtensionCredentials({
		extensionId: extension.id,
		workflow: options.workflow,
		paths: options.paths,
	});
	const runtime = await extension.create({
		config,
		workflow: options.workflow,
		paths: options.paths,
		credentials,
		work: (work) => work,
		registerTool: (tool) => tools.push(tool as PlotExtensionTool),
	});
	return { extension, runtime, credentials, tools, config };
};

const normalizeToolArguments = (
	schema: PlotJsonSchema,
	value: unknown,
): unknown => {
	if (schema.type === "object") {
		const normalized: Record<string, unknown> = {};
		if (!isRecord(value)) return normalized;
		for (const [key, property] of Object.entries(schema.properties ?? {}))
			if (value[key] !== undefined)
				normalized[key] = normalizeToolArguments(property, value[key]);
		return normalized;
	}
	if (schema.type === "array" && schema.items && Array.isArray(value))
		return value.map((item) => normalizeToolArguments(schema.items!, item));
	return value;
};

const toPiToolDefinition = (
	tool: PlotToolDefinition,
	onError?: (error: unknown) => Promise<void> | void,
): ToolDefinition<never, unknown> =>
	({
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		promptSnippet: tool.promptSnippet,
		promptGuidelines: tool.promptGuidelines
			? [...tool.promptGuidelines]
			: undefined,
		executionMode: tool.executionMode,
		prepareArguments: (args: unknown) =>
			normalizeToolArguments(tool.parameters, args),
		execute: async (
			_toolCallId: string,
			params: unknown,
			signal: AbortSignal | undefined,
		) => {
			try {
				const result = await tool.execute(
					normalizeToolArguments(tool.parameters, params) as Record<
						string,
						unknown
					>,
					{ signal } as PlotToolExecutionContext,
				);
				return {
					content: [...result.content],
					details: result.details,
					terminate: result.terminate,
				};
			} catch (error) {
				await onError?.(error);
				throw error;
			}
		},
	}) as unknown as ToolDefinition<never, unknown>;

export const resolveToolDefinitions = async (options: {
	readonly tools: readonly PlotExtensionTool[];
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly work: PlotExtensionWork;
	readonly runId?: string;
	readonly onError?: (error: unknown) => Promise<void> | void;
}): Promise<ToolDefinition[]> => {
	const context = {
		workflow: options.workflow,
		paths: options.paths,
		config: options.config,
		work: options.work,
		runId: options.runId,
	} as PlotToolContext;
	const tools = await Promise.all(
		options.tools.map(async (tool) =>
			typeof tool === "function" ? await tool(context) : tool,
		),
	);
	const names = new Set<string>();
	for (const tool of tools) {
		if (names.has(tool.name))
			throw new Error(`duplicate extension tool name: ${tool.name}`);
		names.add(tool.name);
	}
	return tools.map((tool) => toPiToolDefinition(tool, options.onError));
};
