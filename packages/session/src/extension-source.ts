import { createJiti } from "jiti/static";
import { dirname, isAbsolute, resolve } from "node:path";
import {
	interruptWork,
	setFact,
	sourceId,
	subjectKey,
	workKey,
	type Completion,
	type SourceId,
	type WorkKey,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { logWideEvent } from "@plot/common/observability";
import { TaggedError } from "better-result";
import type { PlotPaths } from "./plot-paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import type {
	MaybePromise,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionWork,
} from "./extension.js";
import * as plotSdk from "@plot/sdk";

export class PlotExtensionSourceError extends TaggedError(
	"PlotExtensionSourceError",
)<{
	readonly phase: "load" | "config" | "create" | "discover" | "hook";
	readonly message: string;
	readonly source?: string;
}>() {}
export interface LoadedPlotExtensionRuntime {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
}
export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly wrapRunner: (runner: WorkRunner) => WorkRunner;
	readonly shutdown: () => Promise<void>;
}
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const runMaybePromise = async <A>(
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
			...(source === undefined ? {} : { source }),
		});
	}
};
const logHookError = (error: unknown, hook: string, source: SourceId) =>
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
const sanitizeIdentifier = (value: string): string => {
	const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
	return sanitized.length === 0 ? "extension" : sanitized;
};
const sourceIdForExtension = (extension: PlotExtension): SourceId =>
	sourceId(`extension:${sanitizeIdentifier(extension.id)}`);
const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): WorkKey =>
	workKey(
		`extension:${extension.id}:${work.id}:${work.version ?? "unversioned"}`,
	);
const completedFactKey = (key: WorkKey) => `extension.completed:${key}`;
const discoveredFactKey = (source: SourceId) =>
	`extension.discovered:${source}`;
const staleReason = (source: SourceId) =>
	`work is no longer current for source ${source}`;
const currentWorkKeys = (
	extension: PlotExtension,
	works: readonly PlotExtensionWork[],
): ReadonlySet<WorkKey> =>
	new Set(works.map((work) => workKeyForExtensionWork(extension, work)));
const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata = {
		id: work.id,
		...(work.version === undefined ? {} : { version: work.version }),
		...(work.title === undefined ? {} : { title: work.title }),
		...(work.url === undefined ? {} : { url: work.url }),
		...(work.subject === undefined ? {} : { subject: work.subject }),
		...(work.display === undefined ? {} : { display: work.display }),
	};
	const base = { workflow: workflow.config, work: metadata };
	if (work.context === undefined) return base;
	if (isObjectRecord(work.context)) return { ...base, ...work.context };
	return { ...base, value: work.context };
};
const toSubject = (work: PlotExtensionWork) =>
	subjectKey(work.subject ?? work.id);
const decodeDiscoveredWorks = (value: unknown): readonly PlotExtensionWork[] =>
	Array.isArray(value) ? (value as readonly PlotExtensionWork[]) : [];
const invokeCompletionHook = async (
	runtime: PlotExtensionRuntime,
	source: SourceId,
	work: PlotExtensionWork,
	completion: Completion,
) => {
	const runId = String(completion.runId);
	try {
		if (completion.status === "succeeded")
			await runtime.completed?.({
				work,
				runId,
				...(completion.output === undefined
					? {}
					: { output: completion.output }),
			});
		else if (completion.status === "failed")
			await runtime.failed?.({
				work,
				runId,
				error: completion.error ?? completion.status,
			});
		else if (completion.status === "timed_out")
			await runtime.timedOut?.({ work, runId });
		else await runtime.interrupted?.({ work, runId });
	} catch (error) {
		await logHookError(error, completion.status, source);
	}
};
export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly workflow: WorkflowDefinition;
	readonly maxConcurrentRuns?: number;
}): PlotExtensionSourceBundle => {
	const source = sourceIdForExtension(options.extension);
	const selectedWork = new Map<WorkKey, PlotExtensionWork>();
	const workSource: WorkSource = {
		id: source,
		...(options.maxConcurrentRuns === undefined
			? {}
			: { policy: { maxConcurrentRuns: options.maxConcurrentRuns } }),
		observeTick: async () => [
			{
				type: "plot.extension.discovered",
				subject: subjectKey(String(source)),
				data: [
					...(await runMaybePromise("discover", String(source), () =>
						options.runtime.discover(),
					)),
				],
			},
		],
		reconcile: async ({ snapshot }) => {
			const proposals = [];
			let discoveredWorks = decodeDiscoveredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			);
			const latestDiscovery = snapshot.observations.findLast(
				(observation) =>
					observation.type === "plot.extension.discovered" &&
					observation.subject === String(source),
			);
			if (latestDiscovery !== undefined) {
				discoveredWorks = decodeDiscoveredWorks(latestDiscovery.data);
				proposals.push(setFact(discoveredFactKey(source), discoveredWorks));
			}
			const currentKeys = currentWorkKeys(options.extension, discoveredWorks);
			for (const run of snapshot.running.values())
				if (run.sourceId === source && !currentKeys.has(run.workKey))
					proposals.push(interruptWork(run.workKey, staleReason(source)));
			for (const completion of snapshot.completions) {
				if (completion.sourceId !== source) continue;
				const work = selectedWork.get(completion.workKey);
				if (work === undefined) continue;
				await invokeCompletionHook(options.runtime, source, work, completion);
				proposals.push(
					setFact(completedFactKey(completion.workKey), {
						status: completion.status,
						...(completion.output === undefined
							? {}
							: { output: completion.output }),
						...(completion.error === undefined
							? {}
							: { error: completion.error }),
					}),
				);
			}
			return proposals;
		},
		selectWork: ({ snapshot }) =>
			decodeDiscoveredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			).flatMap((extensionWork) => {
				const key = workKeyForExtensionWork(options.extension, extensionWork);
				if (
					snapshot.running.has(key) ||
					snapshot.facts.has(completedFactKey(key))
				)
					return [];
				selectedWork.set(key, extensionWork);
				return [
					{
						workKey: key,
						subject: toSubject(extensionWork),
						templateContext: templateContextForWork(
							options.workflow,
							extensionWork,
						),
						...(extensionWork.display === undefined
							? {}
							: { display: extensionWork.display }),
					},
				];
			}),
	};
	return {
		source: workSource,
		wrapRunner: (runner) => ({
			run: async (context: WorkRunnerContext) => {
				const work = selectedWork.get(context.work.workKey);
				if (work !== undefined) {
					try {
						await options.runtime.started?.({
							work,
							runId: String(context.run.runId),
						});
					} catch (error) {
						await logHookError(error, "started", source);
					}
				}
				return runner.run(context);
			},
		}),
		shutdown: async () => {
			try {
				await options.runtime.shutdown?.();
			} catch (error) {
				await logHookError(error, "shutdown", source);
			}
		},
	};
};
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
	if (!isObjectRecord(module)) return undefined;
	const candidate = module["default"] ?? module["extension"];
	if (!isObjectRecord(candidate)) return undefined;
	if (typeof candidate["id"] !== "string") return undefined;
	if (typeof candidate["create"] !== "function") return undefined;
	return candidate as unknown as PlotExtension;
};
const resolveExtensionSourcePath = (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
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
	readonly paths: PlotPaths;
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
	const runtime = await runMaybePromise("create", source, () =>
		extension.create({
			config,
			workflow: options.workflow,
			paths: options.paths,
			work: (input) => input,
		}),
	);
	return { extension, runtime };
};
export const makePlotExtensionSourceBundleFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
}): Promise<PlotExtensionSourceBundle> => {
	const { extension, runtime } =
		await loadPlotExtensionRuntimeFromWorkflow(options);
	return makePlotExtensionSourceBundle({
		extension,
		runtime,
		workflow: options.workflow,
		...(options.workflow.runtime.extension?.maxConcurrentRuns === undefined
			? {}
			: {
					maxConcurrentRuns:
						options.workflow.runtime.extension.maxConcurrentRuns,
				}),
	});
};
