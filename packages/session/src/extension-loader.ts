import { dirname, isAbsolute, resolve } from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti/static";
import { logWideEvent } from "@plot/common/observability";
import { errorMessage, isRecord, type Mutable } from "@plot/common/primitives";
import type { SessionPaths } from "./paths.js";
import type {
	MaybePromise,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
	PlotJsonSchema,
	PlotToolContext,
	PlotToolDefinition,
} from "@plot/sdk";
import * as plotSdk from "@plot/sdk";
import type { WorkflowDefinition } from "./workflow.js";

export class PlotExtensionSourceError extends Error {
	override readonly name = "PlotExtensionSourceError";
	readonly phase: "load" | "config" | "create" | "discover" | "hook";
	readonly source?: string;

	constructor(input: {
		readonly phase: PlotExtensionSourceError["phase"];
		readonly message: string;
		readonly source?: string | undefined;
	}) {
		super(input.message);
		this.phase = input.phase;
		if (input.source !== undefined) this.source = input.source;
	}
}

export const runMaybePromise = async <A>(
	phase: PlotExtensionSourceError["phase"],
	source: string | undefined,
	thunk: () => MaybePromise<A>,
): Promise<A> => {
	try {
		return await Promise.resolve(thunk());
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase,
			message: errorMessage(error),
			source,
		});
	}
};

export const logHookError = (error: unknown, hook: string, source: string) =>
	logWideEvent(
		{
			operation: "plot_extension.hook",
			outcome: "error",
			hook,
			source_id: source,
			error: errorMessage(error),
		},
		"error",
	);

export const validateExtensionWork = (
	work: PlotExtensionWork,
): PlotExtensionWork => {
	if (typeof work.id !== "string" || work.id.length === 0)
		throw new Error("extension work id must be a non-empty string");
	if (work.workspace !== undefined && !isAbsolute(work.workspace))
		throw new Error(
			`work ${work.id} workspace must be an absolute path: ${work.workspace}`,
		);
	return work;
};

export interface LoadedPlotExtensionRuntime {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly tools: readonly PlotExtensionTool[];
	readonly config: unknown;
}

const extensionVirtualModules: Record<string, unknown> = {
	"plot-ai/sdk": plotSdk,
};

const importExtensionModule = async (source: string): Promise<unknown> => {
	const jiti = createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: extensionVirtualModules,
	});
	return jiti.import(source);
};

const getModuleExtension = (module: unknown): PlotExtension | undefined => {
	if (!isRecord(module)) return undefined;
	const candidate = module["default"] ?? module["extension"];
	if (!isRecord(candidate)) return undefined;
	if (typeof candidate["id"] !== "string" || candidate["id"].length === 0)
		return undefined;
	if (typeof candidate["create"] !== "function") return undefined;
	return candidate as unknown as PlotExtension;
};

const resolveExtensionSourcePath = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly source: string;
}) => {
	if (isAbsolute(options.source)) return options.source;
	const base =
		options.workflow.path === undefined
			? options.paths.cwd
			: dirname(options.workflow.path);
	return resolve(base, options.source);
};

export const loadPlotExtensionRuntimeFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): Promise<LoadedPlotExtensionRuntime> => {
	const extensionConfig = options.workflow.runtime.extension;
	if (extensionConfig === undefined)
		throw new PlotExtensionSourceError({
			phase: "load",
			message: "workflow does not configure an extension source",
		});
	const source = resolveExtensionSourcePath({
		workflow: options.workflow,
		paths: options.paths,
		source: extensionConfig.source,
	});
	let module: unknown;
	try {
		module = await importExtensionModule(source);
	} catch (error) {
		throw new PlotExtensionSourceError({
			phase: "load",
			source,
			message: errorMessage(error),
		});
	}
	const extension = getModuleExtension(module);
	if (extension === undefined)
		throw new PlotExtensionSourceError({
			phase: "load",
			source,
			message:
				"extension module must export a PlotExtension as default or extension",
		});
	const config = extension.parseConfig
		? await runMaybePromise("config", source, () =>
				extension.parseConfig?.(extensionConfig.config),
			)
		: extensionConfig.config;
	const tools: PlotExtensionTool[] = [];
	const runtime = await runMaybePromise("create", source, () =>
		extension.create({
			config,
			workflow: options.workflow,
			paths: options.paths,
			work: (input) => validateExtensionWork(input),
			registerTool: (tool) => {
				tools.push(tool as PlotExtensionTool);
			},
		}),
	);
	return { extension, runtime, tools, config };
};

const normalizeToolArguments = (
	schema: PlotJsonSchema,
	value: unknown,
): unknown => {
	if (schema.type === "object") {
		const normalized: Record<string, unknown> = {};
		if (!isRecord(value)) return normalized;
		for (const [key, propertySchema] of Object.entries(
			schema.properties ?? {},
		)) {
			if (value[key] !== undefined)
				normalized[key] = normalizeToolArguments(propertySchema, value[key]);
		}
		return normalized;
	}
	if (schema.type === "array" && Array.isArray(value)) {
		if (schema.items === undefined) return value;
		return value.map((item) => normalizeToolArguments(schema.items!, item));
	}
	return value;
};

const toPiToolDefinition = (
	tool: PlotToolDefinition,
): ToolDefinition<never, unknown> => ({
	name: tool.name,
	label: tool.label,
	description: tool.description,
	parameters: tool.parameters as never,
	prepareArguments: (args) =>
		normalizeToolArguments(tool.parameters, args) as never,
	...(tool.promptSnippet === undefined
		? {}
		: { promptSnippet: tool.promptSnippet }),
	...(tool.promptGuidelines === undefined
		? {}
		: { promptGuidelines: [...tool.promptGuidelines] }),
	...(tool.executionMode === undefined
		? {}
		: { executionMode: tool.executionMode }),
	execute: async (_toolCallId, params, signal) => {
		const context = signal === undefined ? {} : { signal };
		const normalizedParams = normalizeToolArguments(tool.parameters, params);
		const result = await tool.execute(
			normalizedParams as Record<string, unknown>,
			context,
		);
		return {
			content: [...result.content],
			details: result.details,
			...(result.terminate === undefined
				? {}
				: { terminate: result.terminate }),
		};
	},
});

export const resolveToolDefinitions = async (options: {
	readonly tools: readonly PlotExtensionTool[];
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}): Promise<ToolDefinition[]> => {
	const context: Mutable<PlotToolContext> = {
		workflow: options.workflow,
		paths: options.paths,
		config: options.config,
		work: options.work,
	};
	if (options.runId !== undefined) context.runId = options.runId;
	const resolved = await Promise.all(
		options.tools.map((tool) =>
			typeof tool === "function" ? Promise.resolve(tool(context)) : tool,
		),
	);
	const names = new Set<string>();
	for (const tool of resolved) {
		if (names.has(tool.name))
			throw new PlotExtensionSourceError({
				phase: "create",
				message: `duplicate extension tool name: ${tool.name}`,
			});
		names.add(tool.name);
	}
	return resolved.map(toPiToolDefinition);
};
