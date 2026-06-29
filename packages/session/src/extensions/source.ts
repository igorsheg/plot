import {
	interruptWork,
	removeWork,
	setFact,
	upsertWork,
	workKey,
	type WorkKey,
	type WorkRecord,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { isRecord } from "@plot/common/primitives";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
} from "../sdk.js";
import type { SessionPaths } from "../paths.js";
import type { WorkflowDefinition } from "../workflow.js";
import { logHookError } from "./errors.js";
import {
	discover,
	invokeCompletionHook,
	invokeOperatorActionHook,
} from "./hooks.js";
import { loadPlotExtensionRuntimeFromWorkflow } from "./loader.js";
import { resolveToolDefinitions } from "./tools.js";
import {
	currentWorkKeys,
	decodeDiscoveredWorks,
	decodeStoredWorks,
	discoveredFactKey,
	isBlocked,
	releasedReason,
	sourceIdForExtension,
	templateContextForWork,
	toSubject,
	workKeyForExtensionWork,
	workRecordFor,
} from "./work.js";

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly createOptions: (
		context: WorkRunnerContext,
	) => Promise<{ readonly customTools: ToolDefinition[] }>;
	readonly workFor: (
		context: WorkRunnerContext,
	) => PlotExtensionWork | undefined;
	readonly wrapRunner: (runner: WorkRunner) => WorkRunner;
	readonly shutdown: () => Promise<void>;
}

export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly tools?: readonly PlotExtensionTool[];
	readonly maxConcurrentRuns?: number;
	readonly onWorkReleased?: (workId: string) => Promise<void> | void;
}): PlotExtensionSourceBundle => {
	const source = sourceIdForExtension(options.extension);
	const selectedWork = new Map<WorkKey, PlotExtensionWork>();
	const workSource: WorkSource = {
		id: source,
		...(options.maxConcurrentRuns === undefined
			? {}
			: { policy: { maxConcurrentRuns: options.maxConcurrentRuns } }),
		observeTick: async ({ signal }) => [
			{
				type: "plot.extension.discovered",
				subject: String(source),
				data: await discover({ runtime: options.runtime, source, signal }),
			},
		],
		reconcile: async ({ snapshot, signal }) => {
			const proposals = [];
			const previousDiscoveredWorks = decodeStoredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			);
			let discoveredWorks = previousDiscoveredWorks;
			const latestDiscovery = snapshot.observations.findLast(
				(observation) =>
					observation.type === "plot.extension.discovered" &&
					observation.subject === String(source),
			);
			const shouldWriteDiscoveredFact = latestDiscovery !== undefined;
			if (latestDiscovery !== undefined)
				discoveredWorks = decodeDiscoveredWorks(
					latestDiscovery.data,
					String(source),
				);
			for (const work of discoveredWorks)
				selectedWork.set(
					workKeyForExtensionWork(options.extension, work),
					work,
				);
			const operatorActionHooks = [];
			for (const observation of snapshot.observations) {
				if (observation.type !== "operator_observation") continue;
				if (!isRecord(observation.data)) continue;
				if (observation.data["sourceId"] !== source) continue;
				const observedWorkKey = observation.data["workKey"];
				if (typeof observedWorkKey !== "string") continue;
				const work = selectedWork.get(workKey(observedWorkKey));
				if (work === undefined) continue;
				operatorActionHooks.push(
					invokeOperatorActionHook(
						options.runtime,
						source,
						work,
						observation.data,
					),
				);
			}
			await Promise.all(operatorActionHooks);
			const completedThisTickKeys = new Set<WorkKey>();
			const completionHooks = [];
			for (const completion of snapshot.completions) {
				if (completion.sourceId !== source) continue;
				completedThisTickKeys.add(completion.workKey);
				const work = selectedWork.get(completion.workKey);
				if (work === undefined) continue;
				completionHooks.push(
					invokeCompletionHook(options.runtime, source, work, completion),
				);
				if (
					!discoveredWorks.some(
						(candidate) =>
							workKeyForExtensionWork(options.extension, candidate) ===
							completion.workKey,
					)
				)
					selectedWork.delete(completion.workKey);
			}
			await Promise.all(completionHooks);
			if (completedThisTickKeys.size > 0) {
				discoveredWorks = await discover({
					runtime: options.runtime,
					source,
					signal,
				});
				discoveredWorks = discoveredWorks.filter(
					(work) =>
						!completedThisTickKeys.has(
							workKeyForExtensionWork(options.extension, work),
						),
				);
			}
			if (shouldWriteDiscoveredFact || completedThisTickKeys.size > 0)
				proposals.push(setFact(discoveredFactKey(source), discoveredWorks));
			const currentKeys = currentWorkKeys(options.extension, discoveredWorks);
			const currentIds = new Set(discoveredWorks.map((work) => work.id));
			const previousKeys = currentWorkKeys(
				options.extension,
				previousDiscoveredWorks,
			);
			const drainingIds = new Set<string>();
			const runningIds = new Set<string>();
			const drainingKeys = new Set<WorkKey>();
			for (const run of snapshot.running.values()) {
				if (run.sourceId !== source) continue;
				const known = selectedWork.get(run.workKey);
				if (currentKeys.has(run.workKey)) {
					if (known !== undefined) runningIds.add(known.id);
					continue;
				}
				if (known !== undefined && currentIds.has(known.id)) {
					drainingIds.add(known.id);
					drainingKeys.add(run.workKey);
					proposals.push(
						upsertWork(
							workRecordFor(
								options.extension,
								source,
								known,
								"draining",
								run.runId,
							),
						),
					);
					continue;
				}
				proposals.push(interruptWork(run.workKey, releasedReason(source)));
			}
			for (const work of discoveredWorks) {
				const status: WorkRecord["status"] = runningIds.has(work.id)
					? "running"
					: drainingIds.has(work.id)
						? "draining"
						: isBlocked(work)
							? "blocked"
							: "pending";
				const currentRunId = [...snapshot.running.values()].find((run) => {
					if (run.sourceId !== source) return false;
					return (
						run.workKey === workKeyForExtensionWork(options.extension, work)
					);
				})?.runId;
				proposals.push(
					upsertWork(
						workRecordFor(
							options.extension,
							source,
							work,
							status,
							currentRunId,
						),
					),
				);
			}
			const workReleasedHooks = [];
			for (const key of previousKeys) {
				if (currentKeys.has(key) || drainingKeys.has(key)) continue;
				proposals.push(removeWork(key));
				const previous = previousDiscoveredWorks.find(
					(work) => workKeyForExtensionWork(options.extension, work) === key,
				);
				if (!snapshot.running.has(key) && previous !== undefined)
					selectedWork.delete(key);
				if (previous !== undefined && options.onWorkReleased !== undefined)
					workReleasedHooks.push(
						Promise.resolve(options.onWorkReleased(previous.id)).catch(
							(error: unknown) => logHookError(error, "work_released", source),
						),
					);
			}
			await Promise.all(workReleasedHooks);
			return proposals;
		},
		continueWork: async ({ work, signal }) => {
			const active = selectedWork.get(work.workKey);
			if (active === undefined) return false;
			const discovered = await discover({
				runtime: options.runtime,
				source,
				signal,
			});
			return discovered.some(
				(candidate) =>
					!isBlocked(candidate) &&
					workKeyForExtensionWork(options.extension, candidate) ===
						work.workKey,
			);
		},
		selectWork: ({ snapshot }) => {
			const claimedIds = new Set<string>();
			for (const run of snapshot.running.values()) {
				if (run.sourceId !== source) continue;
				const known = selectedWork.get(run.workKey);
				if (known !== undefined) claimedIds.add(known.id);
			}
			return decodeStoredWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			).flatMap((extensionWork) => {
				const key = workKeyForExtensionWork(options.extension, extensionWork);
				if (
					snapshot.running.has(key) ||
					claimedIds.has(extensionWork.id) ||
					isBlocked(extensionWork)
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
						...(extensionWork.operatorActions === undefined
							? {}
							: { operatorActions: extensionWork.operatorActions }),
					},
				];
			});
		},
	};
	return {
		source: workSource,
		workFor: (context) => selectedWork.get(context.work.workKey),
		createOptions: async (context) => {
			const work = selectedWork.get(context.work.workKey);
			if (work === undefined || !options.tools?.length)
				return { customTools: [] };
			return {
				customTools: await resolveToolDefinitions({
					tools: options.tools,
					workflow: options.workflow,
					paths: options.paths,
					config: options.config,
					work,
					runId: String(context.run.runId),
				}),
			};
		},
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
			const controller = new AbortController();
			try {
				await options.runtime.shutdown?.({ signal: controller.signal });
			} catch (error) {
				await logHookError(error, "shutdown", source);
			}
		},
	};
};

export const makePlotExtensionSourceBundleFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly onWorkReleased?: (workId: string) => Promise<void> | void;
}): Promise<PlotExtensionSourceBundle> => {
	const { extension, runtime, tools, config } =
		await loadPlotExtensionRuntimeFromWorkflow(options);
	return makePlotExtensionSourceBundle({
		extension,
		runtime,
		workflow: options.workflow,
		paths: options.paths,
		config,
		tools,
		...(options.onWorkReleased === undefined
			? {}
			: { onWorkReleased: options.onWorkReleased }),
		...(options.workflow.runtime.extension?.maxConcurrentRuns === undefined
			? {}
			: {
					maxConcurrentRuns:
						options.workflow.runtime.extension.maxConcurrentRuns,
				}),
	});
};
