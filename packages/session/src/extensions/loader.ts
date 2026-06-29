import { dirname, isAbsolute, resolve } from "node:path";
import { createJiti } from "jiti/static";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type { SessionPaths } from "../paths.js";
import type {
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
} from "../sdk.js";
import * as plotSdk from "../sdk.js";
import type { WorkflowDefinition } from "../workflow.js";
import { PlotExtensionSourceError, runMaybePromise } from "./errors.js";
import { cleanWork, extensionWorkSchema } from "./work.js";

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
			work: (input) => cleanWork(extensionWorkSchema.parse(input)),
			registerTool: (tool) => {
				tools.push(tool as PlotExtensionTool);
			},
		}),
	);
	return { extension, runtime, tools, config };
};
