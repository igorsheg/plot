import { mkdir } from "node:fs/promises";
import {
	interruptWork,
	removeWork,
	scheduleWake,
	setFact,
	upsertWork,
	type Completion,
	type WorkItem,
	type WorkRecord,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
} from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { WorkflowDefinition } from "./workflow.js";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	logHookError,
	PlotExtensionSourceError,
	resolveToolDefinitions,
	runMaybePromise,
	validateExtensionWork,
} from "./extension-loader.js";

const sanitizeIdentifier = (value: string): string => {
	const sanitized = value.replace(/[^A-Za-z0-9._:-]/g, "_");
	return sanitized.length === 0 ? "extension" : sanitized;
};

export const sourceIdForExtension = (extension: PlotExtension): string =>
	`extension:${sanitizeIdentifier(extension.id)}`;

export const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): string =>
	`extension:${extension.id}:${work.id}:${work.version ?? "unversioned"}`;

export const discoveredFactKey = (source: string) =>
	`extension.discovered:${source}`;
export const releasedReason = (source: string) =>
	`work is no longer discovered by source ${source}`;
export const cancelledReason = (source: string) =>
	`work was cancelled by source ${source}`;
export const isBlocked = (work: PlotExtensionWork) => work.status === "blocked";
export const isWaiting = (work: PlotExtensionWork) => work.status === "waiting";
export const isHeld = (work: PlotExtensionWork) =>
	isBlocked(work) || isWaiting(work);
export const isCancelled = (work: PlotExtensionWork) =>
	work.status === "cancelled";
export const toSubject = (work: PlotExtensionWork) => work.subject ?? work.id;

const validateExtensionWorks = (
	value: unknown,
	source: string | undefined,
): readonly PlotExtensionWork[] => {
	try {
		if (!Array.isArray(value))
			throw new Error("discover must return an array of work items");
		return (value as PlotExtensionWork[]).map(validateExtensionWork);
	} catch (error) {
		const input: { phase: "discover"; message: string; source?: string } = {
			phase: "discover",
			message: errorMessage(error),
		};
		if (source !== undefined) input.source = source;
		throw new PlotExtensionSourceError(input);
	}
};

const storedWorks = (value: unknown): readonly PlotExtensionWork[] =>
	Array.isArray(value) ? (value as PlotExtensionWork[]) : [];

export const workRecordFor = (
	extension: PlotExtension,
	source: string,
	work: PlotExtensionWork,
	status: WorkRecord["status"],
	currentRunId?: string,
): WorkRecord => {
	const record: WorkRecord = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceId: source,
		status,
		subject: toSubject(work),
	};
	if (work.display !== undefined) record.display = work.display;
	if (work.blockedReason !== undefined)
		record.blockedReason = work.blockedReason;
	if (work.operatorActions !== undefined)
		record.operatorActions = [...work.operatorActions];
	if (currentRunId !== undefined) record.currentRunId = currentRunId;
	return record;
};

export const currentWorkKeys = (
	extension: PlotExtension,
	works: readonly PlotExtensionWork[],
): ReadonlySet<string> =>
	new Set(works.map((work) => workKeyForExtensionWork(extension, work)));

export const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const metadata: Record<string, unknown> & { readonly id: string } = {
		id: work.id,
	};
	for (const key of [
		"version",
		"title",
		"url",
		"subject",
		"workspace",
	] as const) {
		const value = work[key];
		if (value !== undefined) metadata[key] = value;
	}
	if (work.display !== undefined) metadata["display"] = work.display;
	if (work.operatorActions !== undefined)
		metadata["operatorActions"] = work.operatorActions;
	const base = { workflow: workflow.config, work: metadata };
	if (work.context === undefined) return base;
	if (isRecord(work.context)) return { ...base, ...work.context };
	return { ...base, value: work.context };
};

export const discover = async (input: {
	readonly runtime: PlotExtensionRuntime;
	readonly source: string;
	readonly signal: AbortSignal;
}): Promise<readonly PlotExtensionWork[]> =>
	validateExtensionWorks(
		await runMaybePromise("discover", String(input.source), () =>
			input.runtime.discover({ signal: input.signal }),
		),
		String(input.source),
	);

export const invokeOperatorActionHook = async (
	runtime: PlotExtensionRuntime,
	source: string,
	work: PlotExtensionWork,
	data: Record<string, unknown>,
) => {
	try {
		const actionId = data["actionId"];
		const actionLabel = data["actionLabel"];
		const timestamp = data["timestamp"];
		if (
			typeof actionId !== "string" ||
			typeof actionLabel !== "string" ||
			typeof timestamp !== "string"
		)
			return;
		await runtime.operatorAction?.({
			work,
			actionId,
			actionLabel,
			timestamp,
			...(typeof data["comment"] === "string"
				? { comment: data["comment"] }
				: {}),
			...(typeof data["clientId"] === "string"
				? { clientId: data["clientId"] }
				: {}),
			...(data["actor"] === undefined ? {} : { actor: data["actor"] }),
		});
	} catch (error) {
		await logHookError(error, "operator_action", source);
	}
};

export const invokeCompletionHook = async (
	runtime: PlotExtensionRuntime,
	source: string,
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

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly createOptions: (context: WorkRunnerContext) => Promise<{
		readonly customTools: ToolDefinition[];
		readonly cwd?: string;
	}>;
	readonly workFor: (
		context: WorkRunnerContext,
	) => PlotExtensionWork | undefined;
	readonly wrapRunner: (runner: WorkRunner) => WorkRunner;
	readonly shutdown: () => Promise<void>;
}

// Symphony SPEC 8.4 retry policy on Plot's existing scheduleWake primitive.
// ponytail: constants are Symphony's defaults; expose in the workflow
// extension config when someone actually needs to tune them.
const RETRY_BASE_DELAY_MS = 10_000;
const RETRY_MAX_DELAY_MS = 300_000;
const retryDelayMs = (attempt: number) =>
	Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
const retryFactKey = (source: string) => `extension.retry:${source}`;
const decodeRetryState = (value: unknown): Record<string, number> => {
	if (!isRecord(value)) return {};
	const state: Record<string, number> = {};
	for (const [key, attempt] of Object.entries(value))
		if (typeof attempt === "number" && Number.isInteger(attempt) && attempt > 0)
			state[key] = attempt;
	return state;
};

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
	const selectedWork = new Map<string, PlotExtensionWork>();
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
		reconcile: async ({ snapshot }) => {
			const proposals = [];
			const previousDiscoveredWorks = storedWorks(
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
				discoveredWorks = validateExtensionWorks(
					latestDiscovery.data,
					String(source),
				);
			// Cancelled work is the one discovery state that interrupts a running
			// attempt. It never reaches the stored fact or the work board.
			const cancelledIds = new Set(
				discoveredWorks.filter(isCancelled).map((work) => work.id),
			);
			if (cancelledIds.size > 0)
				discoveredWorks = discoveredWorks.filter((work) => !isCancelled(work));
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
				const work = selectedWork.get(observedWorkKey);
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
			const completedThisTickKeys = new Set<string>();
			const completionHooks = [];
			const retryState = decodeRetryState(
				snapshot.facts.get(retryFactKey(source)),
			);
			let retryChanged = false;
			for (const completion of snapshot.completions) {
				if (completion.sourceId !== source) continue;
				completedThisTickKeys.add(completion.workKey);
				// Failed and timed-out runs redispatch with exponential backoff.
				// Success and interruption (a deliberate act) reset the counter.
				if (
					completion.status === "failed" ||
					completion.status === "timed_out"
				) {
					const attempt = (retryState[String(completion.workKey)] ?? 0) + 1;
					retryState[String(completion.workKey)] = attempt;
					retryChanged = true;
					proposals.push(
						scheduleWake(retryDelayMs(attempt), {
							workKey: completion.workKey,
							attempt,
							reason: `retry backoff after ${completion.status} run`,
						}),
					);
				} else if (retryState[String(completion.workKey)] !== undefined) {
					delete retryState[String(completion.workKey)];
					retryChanged = true;
				}
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
			// Backoff resets when the world moves on: a key no longer discovered
			// (done, released, or superseded by a new version) drops its counter.
			const discoveredKeys = currentWorkKeys(
				options.extension,
				discoveredWorks,
			);
			for (const key of Object.keys(retryState))
				if (!discoveredKeys.has(key)) {
					delete retryState[key];
					retryChanged = true;
				}
			if (retryChanged)
				proposals.push(setFact(retryFactKey(source), retryState));
			// Completed keys are filtered from the stored fact instead of
			// re-polling; the next tick's observation refreshes domain truth.
			if (completedThisTickKeys.size > 0)
				discoveredWorks = discoveredWorks.filter(
					(work) =>
						!completedThisTickKeys.has(
							workKeyForExtensionWork(options.extension, work),
						),
				);
			if (shouldWriteDiscoveredFact || completedThisTickKeys.size > 0)
				proposals.push(setFact(discoveredFactKey(source), discoveredWorks));
			const currentKeys = currentWorkKeys(options.extension, discoveredWorks);
			const previousKeys = currentWorkKeys(
				options.extension,
				previousDiscoveredWorks,
			);
			const drainingIds = new Set<string>();
			const runningIds = new Set<string>();
			const drainingKeys = new Set<string>();
			const interruptedThisTick = new Set<string>();
			for (const run of snapshot.running.values()) {
				if (run.sourceId !== source) continue;
				const known = selectedWork.get(run.workKey);
				if (known !== undefined && cancelledIds.has(known.id)) {
					interruptedThisTick.add(run.workKey);
					proposals.push(interruptWork(run.workKey, cancelledReason(source)));
					continue;
				}
				if (currentKeys.has(run.workKey)) {
					if (known !== undefined) runningIds.add(known.id);
					continue;
				}
				// Undiscovered or superseded while running: drain, never interrupt.
				// The run finishes its current turn (a run that just made its own
				// work done must not be shot for succeeding), continueWork stops
				// continuation turns, and the claim is released on completion.
				if (known !== undefined) {
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
				// A run whose work was never tracked cannot be described or drained.
				interruptedThisTick.add(run.workKey);
				proposals.push(interruptWork(run.workKey, releasedReason(source)));
			}
			for (const work of discoveredWorks) {
				const status: WorkRecord["status"] = runningIds.has(work.id)
					? "running"
					: drainingIds.has(work.id)
						? "draining"
						: isBlocked(work)
							? "blocked"
							: isWaiting(work)
								? "waiting"
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
			// Stale records include keys from the previous fact and any leftover
			// source-owned records (for example a drained run that has completed).
			const staleKeys = new Set<string>(previousKeys);
			for (const [key, record] of snapshot.work)
				if (record.sourceId === source) staleKeys.add(key);
			for (const key of staleKeys) {
				if (currentKeys.has(key) || drainingKeys.has(key)) continue;
				const running = snapshot.running.has(key);
				if (running && !interruptedThisTick.has(key)) continue;
				proposals.push(removeWork(key));
				if (!running) selectedWork.delete(key);
				const previous = previousDiscoveredWorks.find(
					(work) => workKeyForExtensionWork(options.extension, work) === key,
				);
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
		// Continuation consults the current tick's reconciled fact instead of
		// polling the extension again; staleness is bounded by the tick interval.
		continueWork: ({ work, snapshot }) => {
			if (!selectedWork.has(work.workKey)) return false;
			return storedWorks(snapshot.facts.get(discoveredFactKey(source))).some(
				(candidate) =>
					!isHeld(candidate) &&
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
			// A pending scheduled wake is a retry hold: the core prunes wakes at
			// their due time, and the wake itself triggers the redispatch tick.
			const heldKeys = new Set(
				(snapshot.scheduledWakes ?? []).flatMap((wake) =>
					wake.workKey === undefined ? [] : [wake.workKey],
				),
			);
			return storedWorks(snapshot.facts.get(discoveredFactKey(source))).flatMap(
				(extensionWork) => {
					const key = workKeyForExtensionWork(options.extension, extensionWork);
					if (
						snapshot.running.has(key) ||
						heldKeys.has(key) ||
						claimedIds.has(extensionWork.id) ||
						isHeld(extensionWork)
					)
						return [];
					selectedWork.set(key, extensionWork);
					const item: WorkItem = {
						workKey: key,
						subject: toSubject(extensionWork),
						templateContext: templateContextForWork(
							options.workflow,
							extensionWork,
						),
					};
					if (extensionWork.display !== undefined)
						item.display = extensionWork.display;
					if (extensionWork.operatorActions !== undefined)
						item.operatorActions = [...extensionWork.operatorActions];
					return [item];
				},
			);
		},
	};
	return {
		source: workSource,
		workFor: (context) => selectedWork.get(context.work.workKey),
		createOptions: async (context) => {
			const work = selectedWork.get(context.work.workKey);
			const cwd = work?.workspace;
			const customTools =
				work === undefined || !options.tools?.length
					? []
					: await resolveToolDefinitions({
							tools: options.tools,
							workflow: options.workflow,
							paths: options.paths,
							config: options.config,
							work,
							runId: String(context.run.runId),
						});
			const createOptions: { customTools: ToolDefinition[]; cwd?: string } = {
				customTools,
			};
			if (cwd !== undefined) createOptions.cwd = cwd;
			return createOptions;
		},
		wrapRunner: (runner) => ({
			run: async (context: WorkRunnerContext) => {
				const work = selectedWork.get(context.work.workKey);
				// Workspace creation failure is fatal to the attempt, mirroring
				// Symphony's workspace-preparation contract.
				if (work?.workspace !== undefined)
					await mkdir(work.workspace, { recursive: true });
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
