import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
	interruptWork,
	removeWork,
	scheduleWake,
	setFact,
	upsertSource,
	upsertWork,
	type Completion,
	type SourceRecord,
	type SourceRequirementRecord,
	type WorkItem,
	type WorkRecord,
} from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { isRecord } from "@plot/common/primitives";
import {
	DiscoveryUnavailableError,
	ExtensionActionRequiredError,
} from "@plot/sdk";
import type {
	ExtensionCredentials,
	ExtensionInteraction,
	ExtensionRequirement,
	ExtensionRequirementState,
	PlotExtension,
	PlotExtensionOperatorActionEvent,
	PlotExtensionRuntime,
	PlotExtensionTool,
	PlotExtensionWork,
} from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { PiAgentSessionRunOptions } from "./pi-runner.js";
import type { WorkflowDefinition } from "./workflow.js";
import {
	loadPlotExtensionRuntimeFromWorkflow,
	resolveToolDefinitions,
} from "./extension-loader.js";

export const sourceIdForExtension = (extension: PlotExtension): string =>
	`extension:${encodeURIComponent(extension.id)}`;

export const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): string =>
	`extension:${JSON.stringify([extension.id, work.id, work.version ?? null])}`;

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

const storedWorks = (value: unknown): readonly PlotExtensionWork[] =>
	(value as readonly PlotExtensionWork[] | undefined) ?? [];

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

const requirementRecord = (
	requirement: ExtensionRequirement,
	state: ExtensionRequirementState,
): SourceRequirementRecord => {
	if (state.status === "ready")
		return { id: requirement.id, label: requirement.label, status: "ready" };
	if (state.status === "action-required")
		return {
			id: requirement.id,
			label: requirement.label,
			status: state.status,
			message: state.message,
			actions: [...state.actions],
		};
	const record: {
		id: string;
		label: string;
		status: "unavailable";
		message: string;
		retryAfterMs?: number;
	} = {
		id: requirement.id,
		label: requirement.label,
		status: state.status,
		message: state.message,
	};
	if (state.retryAfterMs !== undefined)
		record.retryAfterMs = state.retryAfterMs;
	return record;
};

const sourceReadiness = (
	sourceId: string,
	label: string,
	requirements: readonly SourceRequirementRecord[],
): SourceRecord => {
	const readiness = requirements.some(
		(item) => item.status === "action-required",
	)
		? "action-required"
		: requirements.some((item) => item.status === "unavailable")
			? "unavailable"
			: "ready";
	const record: {
		sourceId: string;
		label: string;
		readiness: SourceRecord["readiness"];
		requirements: readonly SourceRequirementRecord[];
		message?: string;
	} = { sourceId, label, readiness, requirements };
	const message = requirements.find((item) => item.status !== "ready")?.message;
	if (message !== undefined) record.message = message;
	return record;
};

export const extensionRequirements = (
	runtime: PlotExtensionRuntime,
): readonly ExtensionRequirement[] => {
	const requirements = runtime.requirements ?? [];
	const requirementIds = new Set<string>();
	for (const requirement of requirements) {
		if (requirement.id.length === 0)
			throw new Error("extension requirement id must be a non-empty string");
		if (requirementIds.has(requirement.id))
			throw new Error(`duplicate extension requirement id: ${requirement.id}`);
		requirementIds.add(requirement.id);
	}
	return requirements;
};

export const checkRequirements = async (input: {
	readonly sourceId: string;
	readonly label: string;
	readonly requirements: readonly ExtensionRequirement[];
	readonly credentials: ExtensionCredentials;
	readonly signal: AbortSignal;
}): Promise<SourceRecord> => {
	const checked = await Promise.all(
		input.requirements.map(async (requirement) => {
			const state = await requirement.check({
				signal: input.signal,
				credentials: input.credentials,
			});
			if (
				state.status !== "ready" &&
				state.status !== "action-required" &&
				state.status !== "unavailable"
			)
				throw new Error(
					`requirement ${requirement.id} returned an invalid status`,
				);
			return requirementRecord(requirement, state);
		}),
	);
	return sourceReadiness(input.sourceId, input.label, checked);
};

export const discover = async (input: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly signal: AbortSignal;
}): Promise<readonly PlotExtensionWork[]> => {
	const value = await input.runtime.discover({ signal: input.signal });
	if (!Array.isArray(value)) throw new Error("discover must return an array");
	const keys = new Set<string>();
	for (const work of value) {
		if (typeof work.id !== "string" || work.id.length === 0)
			throw new Error("extension work id must be a non-empty string");
		if (work.workspace !== undefined && !isAbsolute(work.workspace))
			throw new Error(`work ${work.id} workspace must be an absolute path`);
		const key = workKeyForExtensionWork(input.extension, work);
		if (keys.has(key)) throw new Error(`duplicate discovered work: ${key}`);
		keys.add(key);
	}
	return value;
};

export const invokeOperatorActionHook = async (
	runtime: PlotExtensionRuntime,
	work: PlotExtensionWork,
	data: Record<string, unknown>,
) =>
	await runtime.operatorAction?.({
		work,
		...data,
	} as unknown as PlotExtensionOperatorActionEvent);

export const invokeCompletionHook = async (
	runtime: PlotExtensionRuntime,
	work: PlotExtensionWork,
	completion: Completion,
) => {
	const runId = completion.runId;
	if (completion.status === "succeeded")
		return runtime.completed?.({ work, runId, output: completion.output });
	if (completion.status === "failed")
		return runtime.failed?.({
			work,
			runId,
			error: completion.error ?? completion.status,
		});
	if (completion.status === "timed_out")
		return runtime.timedOut?.({ work, runId });
	return runtime.interrupted?.({ work, runId });
};

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly runAction: (input: {
		readonly requirementId: string;
		readonly actionId: string;
		readonly interaction: ExtensionInteraction;
		readonly signal: AbortSignal;
	}) => Promise<SourceRecord>;
	readonly createOptions: (
		context: WorkRunnerContext,
	) => Promise<PiAgentSessionRunOptions>;
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
const decodeRetryState = (value: unknown): Record<string, number> => ({
	...(value as Record<string, number> | undefined),
});

export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly credentials?: ExtensionCredentials;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly tools?: readonly PlotExtensionTool[] | undefined;
	readonly maxConcurrentRuns?: number | undefined;
}): PlotExtensionSourceBundle => {
	const source = sourceIdForExtension(options.extension);
	const label = options.extension.label ?? options.extension.id;
	const requirements = extensionRequirements(options.runtime);
	const memoryCredentials = new Map<string, unknown>();
	const credentials: ExtensionCredentials = options.credentials ?? {
		get: async <T>(key: string) => memoryCredentials.get(key) as T | undefined,
		set: async (key, value) => {
			memoryCredentials.set(key, value);
		},
		delete: async (key) => {
			memoryCredentials.delete(key);
		},
	};
	let forcedActionRequired:
		| { readonly requirementId: string; readonly message: string }
		| undefined;
	const applyForcedReadiness = (readiness: SourceRecord): SourceRecord => {
		const forced = forcedActionRequired;
		if (forced === undefined) return readiness;
		const target = readiness.requirements.find(
			(requirement) => requirement.id === forced.requirementId,
		);
		if (target === undefined) return readiness;
		const nextRequirements = readiness.requirements.map((requirement) =>
			requirement.id === forced.requirementId
				? {
						...requirement,
						status: "action-required" as const,
						message: forced.message,
					}
				: requirement,
		);
		return {
			...readiness,
			readiness: "action-required",
			requirements: nextRequirements,
		};
	};
	const selectedWork = new Map<string, PlotExtensionWork>();
	const activeRuns = new Map<string, PlotExtensionWork>();
	const actions = new Map<string, Promise<SourceRecord>>();
	let readinessCheck: Promise<SourceRecord> | undefined;
	const checkReadiness = (signal: AbortSignal): Promise<SourceRecord> => {
		if (readinessCheck !== undefined) return readinessCheck;
		readinessCheck = checkRequirements({
			sourceId: source,
			label,
			requirements,
			credentials,
			signal,
		});
		void readinessCheck.then(
			() => {
				readinessCheck = undefined;
				return undefined;
			},
			() => {
				readinessCheck = undefined;
				return undefined;
			},
		);
		return readinessCheck;
	};
	const workSource: WorkSource = {
		id: source,
		label,
		requirements: requirements.map(({ id, label: requirementLabel }) => ({
			id,
			label: requirementLabel,
		})),
		observeTick: async ({ snapshot, signal }) => {
			if (actions.size > 0) {
				const current = snapshot.sources.get(source);
				return current === undefined
					? []
					: [
							{
								type: "plot.extension.readiness",
								subject: source,
								data: current,
							},
						];
			}
			const readiness = applyForcedReadiness(await checkReadiness(signal));
			const observations = [
				{
					type: "plot.extension.readiness",
					subject: source,
					data: readiness,
				},
			];
			if (readiness.readiness !== "ready") return observations;
			try {
				return [
					...observations,
					{
						type: "plot.extension.discovered",
						subject: source,
						data: await discover({
							extension: options.extension,
							runtime: options.runtime,
							signal,
						}),
					},
				];
			} catch (error) {
				if (error instanceof DiscoveryUnavailableError)
					return [
						{
							type: "plot.extension.readiness",
							subject: source,
							data: {
								...readiness,
								readiness: "unavailable",
								message: error.message,
							},
						},
					];
				if (!(error instanceof ExtensionActionRequiredError)) throw error;
				forcedActionRequired = {
					requirementId: error.requirementId,
					message: error.message,
				};
				return [
					{
						type: "plot.extension.readiness",
						subject: source,
						data: applyForcedReadiness(await checkReadiness(signal)),
					},
				];
			}
		},
		reconcile: async ({ snapshot }) => {
			const proposals = [];
			const latestReadiness = snapshot.observations.findLast(
				(observation) =>
					observation.type === "plot.extension.readiness" &&
					observation.subject === source,
			);
			if (latestReadiness !== undefined)
				proposals.push(upsertSource(latestReadiness.data as SourceRecord));
			const previousDiscoveredWorks = storedWorks(
				snapshot.facts.get(discoveredFactKey(source)),
			);
			let discoveredWorks = previousDiscoveredWorks;
			const latestDiscovery = snapshot.observations.findLast(
				(observation) =>
					observation.type === "plot.extension.discovered" &&
					observation.subject === source,
			);
			const shouldWriteDiscoveredFact = latestDiscovery !== undefined;
			if (latestDiscovery !== undefined)
				discoveredWorks = storedWorks(latestDiscovery.data);
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
					invokeOperatorActionHook(options.runtime, work, observation.data),
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
					const attempt = (retryState[completion.workKey] ?? 0) + 1;
					retryState[completion.workKey] = attempt;
					retryChanged = true;
					proposals.push(
						scheduleWake(retryDelayMs(attempt), {
							workKey: completion.workKey,
							attempt,
							reason: `retry backoff after ${completion.status} run`,
						}),
					);
				} else if (retryState[completion.workKey] !== undefined) {
					delete retryState[completion.workKey];
					retryChanged = true;
				}
				const work =
					selectedWork.get(completion.workKey) ??
					activeRuns.get(completion.runId);
				if (work === undefined) continue;
				completionHooks.push(
					invokeCompletionHook(options.runtime, work, completion).finally(
						() => {
							activeRuns.delete(completion.runId);
						},
					),
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
			}
			return proposals;
		},
		// Continuation consults the current tick's reconciled fact instead of
		// polling the extension again; staleness is bounded by the tick interval.
		continueWork: ({ work, snapshot }) => {
			if (snapshot.sources.get(source)?.readiness !== "ready") return false;
			if (!selectedWork.has(work.workKey)) return false;
			return storedWorks(snapshot.facts.get(discoveredFactKey(source))).some(
				(candidate) =>
					!isHeld(candidate) &&
					workKeyForExtensionWork(options.extension, candidate) ===
						work.workKey,
			);
		},
		selectWork: ({ snapshot }) => {
			if (snapshot.sources.get(source)?.readiness !== "ready") return [];
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
	if (options.maxConcurrentRuns !== undefined)
		workSource.policy = { maxConcurrentRuns: options.maxConcurrentRuns };
	const runAction: PlotExtensionSourceBundle["runAction"] = (input) => {
		const active = actions.get(input.requirementId);
		if (active !== undefined) return active;
		const action = (async () => {
			const requirement = requirements.find(
				(candidate) => candidate.id === input.requirementId,
			);
			if (requirement === undefined)
				throw new Error(
					`unknown extension requirement: ${input.requirementId}`,
				);
			const before = await checkReadiness(input.signal);
			const state = before.requirements.find(
				(candidate) => candidate.id === requirement.id,
			);
			if (state?.status !== "action-required")
				throw new Error(
					`extension requirement ${requirement.id} needs no action`,
				);
			if (!state.actions?.some((candidate) => candidate.id === input.actionId))
				throw new Error(
					`unknown action ${input.actionId} for extension requirement ${requirement.id}`,
				);
			if (requirement.action === undefined)
				throw new Error(
					`extension requirement ${requirement.id} has no action hook`,
				);
			await requirement.action({
				actionId: input.actionId,
				signal: input.signal,
				credentials,
				interaction: input.interaction,
			});
			forcedActionRequired = undefined;
			return checkReadiness(input.signal);
		})();
		actions.set(input.requirementId, action);
		void action.then(
			() => actions.delete(input.requirementId),
			() => actions.delete(input.requirementId),
		);
		return action;
	};
	let shutdownPromise: Promise<void> | undefined;
	return {
		source: workSource,
		runAction,
		createOptions: async (context) => {
			const work = selectedWork.get(context.work.workKey)!;
			const customTools = options.tools?.length
				? await resolveToolDefinitions({
						tools: options.tools,
						workflow: options.workflow,
						paths: options.paths,
						config: options.config,
						work,
						runId: context.run.runId,
						onError: (error) => {
							if (!(error instanceof ExtensionActionRequiredError)) return;
							forcedActionRequired = {
								requirementId: error.requirementId,
								message: error.message,
							};
						},
					})
				: [];
			return { customTools, cwd: work.workspace };
		},
		wrapRunner: (runner) => ({
			run: async (context: WorkRunnerContext) => {
				const work = selectedWork.get(context.work.workKey)!;
				const runId = context.run.runId;
				activeRuns.set(runId, work);
				if (work.workspace) await mkdir(work.workspace, { recursive: true });
				await options.runtime.started?.({ work, runId });
				return runner.run(context);
			},
		}),
		shutdown: () => {
			shutdownPromise ??= (async () => {
				const interrupted = [...activeRuns].map(([runId, work]) =>
					invokeCompletionHook(options.runtime, work, {
						runId,
						sourceId: source,
						workKey: workKeyForExtensionWork(options.extension, work),
						status: "interrupted",
					}),
				);
				await Promise.all(interrupted);
				activeRuns.clear();
				await options.runtime.shutdown?.();
			})();
			return shutdownPromise;
		},
	};
};

export const makePlotExtensionSourceBundleFromWorkflow = async (options: {
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
}): Promise<PlotExtensionSourceBundle> => {
	const { extension, runtime, credentials, tools, config } =
		await loadPlotExtensionRuntimeFromWorkflow(options);
	return makePlotExtensionSourceBundle({
		extension,
		runtime,
		credentials,
		workflow: options.workflow,
		paths: options.paths,
		config,
		tools,
		maxConcurrentRuns: options.workflow.runtime.extension?.maxConcurrentRuns,
	});
};
