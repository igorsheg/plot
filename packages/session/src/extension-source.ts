import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
	Completion,
	SourceRecord,
	SourceRequirementRecord,
	SourceWorkRecord,
	WorkItem,
} from "@plot/agent/model";
import type { WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { errorMessage, isRecord } from "@plot/common/primitives";
import {
	DiscoveryUnavailableError,
	ExtensionActionRequiredError,
} from "@plot/sdk";
import type {
	ExtensionCredentials,
	ExtensionInteraction,
	ExtensionRequirement,
	ExtensionRequirementState,
	ExtensionRunCompletion,
	PlotExtension,
	PlotExtensionRuntime,
	PlotExtensionWork,
} from "@plot/sdk";
import type { SessionPaths } from "./paths.js";
import type { PiAgentSessionRunOptions } from "./pi-runner.js";
import type { WorkflowDefinition } from "./workflow.js";
import { resolveToolDefinitions } from "./extension-loader.js";
import { createLoopbackOAuthCallback } from "./interaction.js";

const RETRY_BASE_DELAY_MS = 10_000;
const RETRY_MAX_DELAY_MS = 300_000;
const SOURCE_SHUTDOWN_MS = 5_000;
const DISCOVERED_WORK_CAPACITY = 1024;
const DISCOVERY_REQUIREMENT_ID = "plot:discovery";

export const sourceIdForExtension = (extension: PlotExtension): string =>
	`extension:${encodeURIComponent(extension.id)}`;

export const workKeyForExtensionWork = (
	extension: PlotExtension,
	work: PlotExtensionWork,
): string =>
	`extension:${JSON.stringify([extension.id, work.id, work.version ?? null])}`;

export const templateContextForWork = (
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
) => {
	const {
		context,
		status: _status,
		blockedReason: _reason,
		...metadata
	} = work;
	const base = { workflow: workflow.config, work: metadata };
	if (context === undefined) return base;
	if (isRecord(context)) return { ...base, ...context };
	return { ...base, value: context };
};

const retryDelayMs = (attempt: number) =>
	Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);

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
			status: "action-required",
			message: state.message,
			actions: [...state.actions],
		};
	return {
		id: requirement.id,
		label: requirement.label,
		status: "unavailable",
		message: state.message,
		retryAfterMs: state.retryAfterMs,
	};
};

const sourceRecord = (
	sourceId: string,
	label: string,
	requirements: readonly SourceRequirementRecord[],
): SourceRecord => {
	const blocked = requirements.find(
		(item) =>
			item.status === "action-required" || item.status === "unavailable",
	);
	return {
		sourceId,
		label,
		readiness: blocked?.status ?? "ready",
		message: blocked?.message,
		requirements,
	};
};

export const extensionRequirements = (
	runtime: PlotExtensionRuntime,
): readonly ExtensionRequirement[] => {
	const requirements = runtime.requirements ?? [];
	const ids = new Set<string>();
	for (const requirement of requirements) {
		if (requirement.id.length === 0)
			throw new Error("extension requirement id must be a non-empty string");
		if (ids.has(requirement.id))
			throw new Error(`duplicate extension requirement id: ${requirement.id}`);
		ids.add(requirement.id);
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
	const records = await Promise.all(
		input.requirements.map(async (requirement) =>
			requirementRecord(
				requirement,
				await requirement.check({
					signal: input.signal,
					credentials: input.credentials,
				}),
			),
		),
	);
	return sourceRecord(input.sourceId, input.label, records);
};

const discover = async (input: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly signal: AbortSignal;
}): Promise<readonly PlotExtensionWork[]> => {
	const value = await input.runtime.discover({ signal: input.signal });
	if (!Array.isArray(value)) throw new Error("discover must return an array");
	if (value.length > DISCOVERED_WORK_CAPACITY)
		throw new Error(
			`discover returned more than ${DISCOVERED_WORK_CAPACITY} Work Items`,
		);
	const keys = new Set<string>();
	for (const work of value) {
		if (typeof work.id !== "string" || work.id.length === 0)
			throw new Error("extension work id must be a non-empty string");
		if (work.workspace !== undefined && !isAbsolute(work.workspace))
			throw new Error(`work ${work.id} workspace must be an absolute path`);
		if (
			work.status !== undefined &&
			work.status !== "pending" &&
			work.status !== "waiting" &&
			work.status !== "blocked" &&
			work.status !== "cancelled"
		)
			throw new Error(`work ${work.id} has an invalid status`);
		const key = workKeyForExtensionWork(input.extension, work);
		if (keys.has(key)) throw new Error(`duplicate discovered work: ${key}`);
		keys.add(key);
	}
	return value;
};

const extensionWork = (item: WorkItem): PlotExtensionWork =>
	item.sourceData as PlotExtensionWork;

const runCompletion = (completion: Completion): ExtensionRunCompletion => {
	if (completion.status === "succeeded") {
		if (completion.output === undefined) return { status: "succeeded" };
		return { status: "succeeded", output: completion.output };
	}
	if (completion.status === "failed")
		return { status: "failed", error: completion.error };
	if (completion.status === "interrupted")
		return { status: "interrupted", reason: completion.reason };
	return { status: "timed_out", reason: completion.reason };
};

const workRecord = (
	extension: PlotExtension,
	sourceId: string,
	work: PlotExtensionWork,
): SourceWorkRecord => {
	const identity = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceId,
		subject: work.subject ?? work.id,
		display: work.display,
	};
	if (work.status === "blocked")
		return {
			...identity,
			status: "blocked",
			reason: work.blockedReason ?? "Operator action required",
			operatorActions: work.operatorActions ?? [],
		};
	if (work.status === "waiting")
		return {
			...identity,
			status: "waiting",
			reason: work.blockedReason,
			operatorActions: work.operatorActions,
		};
	return {
		...identity,
		status: "pending",
		operatorActions: work.operatorActions,
	};
};

const workItem = (
	extension: PlotExtension,
	workflow: WorkflowDefinition,
	work: PlotExtensionWork,
): WorkItem => {
	return {
		workKey: workKeyForExtensionWork(extension, work),
		subject: work.subject ?? work.id,
		templateContext: templateContextForWork(workflow, work),
		sourceData: work,
		display: work.display,
		operatorActions: work.operatorActions,
	};
};

export interface SourceActionEvents {
	readonly started: (actionRunId: string) => Promise<unknown>;
	readonly progress: (actionRunId: string, message: string) => Promise<unknown>;
	readonly openUrl: (
		actionRunId: string,
		url: string,
		fallbackText?: string,
	) => Promise<unknown>;
	readonly completed: (
		actionRunId: string,
		source: SourceRecord,
	) => Promise<unknown>;
	readonly failed: (actionRunId: string, message: string) => Promise<unknown>;
	readonly cancelled: (actionRunId: string) => Promise<unknown>;
}

export type SourceActionStartResult =
	| { readonly accepted: false }
	| { readonly accepted: true; readonly actionRunId: string };

export interface PlotExtensionSourceBundle {
	readonly source: WorkSource;
	readonly startAction: (input: {
		readonly requirementId: string;
		readonly actionId: string;
		readonly events: SourceActionEvents;
	}) => Promise<SourceActionStartResult>;
	readonly cancelAction: (actionRunId: string) => boolean;
	readonly createOptions: (
		context: WorkRunnerContext,
	) => Promise<PiAgentSessionRunOptions>;
	readonly shutdown: () => Promise<void>;
}

interface ActiveAction {
	readonly requirementId: string;
	readonly controller: AbortController;
	readonly promise: Promise<void>;
}

export const makePlotExtensionSourceBundle = (options: {
	readonly extension: PlotExtension;
	readonly runtime: PlotExtensionRuntime;
	readonly credentials: ExtensionCredentials;
	readonly workflow: WorkflowDefinition;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly maxConcurrentRuns: number;
}): PlotExtensionSourceBundle => {
	const sourceId = sourceIdForExtension(options.extension);
	const label = options.extension.label ?? options.extension.id;
	const requirements = extensionRequirements(options.runtime);
	const credentials = options.credentials;
	let currentSource = sourceRecord(
		sourceId,
		label,
		requirements.map(({ id, label: requirementLabel }) => ({
			id,
			label: requirementLabel,
			status: "checking",
		})),
	);
	let forcedAction:
		| { readonly requirementId: string; readonly message: string }
		| undefined;
	let discovered = new Map<string, PlotExtensionWork>();
	const retries = new Map<string, { attempt: number; dueAtMs: number }>();
	const completedSinceReconcile = new Set<string>();
	const pendingWakes: {
		delayMs: number;
		reason: string;
		workKey: string;
		attempt: number;
	}[] = [];
	const actions = new Map<string, ActiveAction>();

	const withForcedAction = (record: SourceRecord): SourceRecord => {
		const forced = forcedAction;
		if (forced === undefined) return record;
		return sourceRecord(
			sourceId,
			label,
			record.requirements.map((requirement) =>
				requirement.id === forced.requirementId
					? {
							id: requirement.id,
							label: requirement.label,
							status: "action-required",
							message: forced.message,
							actions:
								requirement.status === "action-required"
									? requirement.actions
									: [],
						}
					: requirement,
			),
		);
	};
	const check = async (signal: AbortSignal) => {
		currentSource = withForcedAction(
			await checkRequirements({
				sourceId,
				label,
				requirements,
				credentials,
				signal,
			}),
		);
		return currentSource;
	};
	const source: WorkSource = {
		initial: currentSource,
		maxConcurrentRuns: options.maxConcurrentRuns,
		reconcile: async ({ signal, operatorObservations, activeRuns }) => {
			let found: readonly PlotExtensionWork[] | undefined;
			if (actions.size === 0) {
				const readiness = await check(signal);
				if (readiness.readiness === "ready") {
					try {
						found = await discover({
							extension: options.extension,
							runtime: options.runtime,
							signal,
						});
					} catch (error) {
						if (error instanceof ExtensionActionRequiredError) {
							forcedAction = {
								requirementId: error.requirementId,
								message: error.message,
							};
							currentSource = withForcedAction(readiness);
						} else if (error instanceof DiscoveryUnavailableError) {
							currentSource = sourceRecord(sourceId, label, [
								...readiness.requirements,
								{
									id: DISCOVERY_REQUIREMENT_ID,
									label: "Discovery",
									status: "unavailable",
									message: error.message,
								},
							]);
						} else throw error;
					}
				}
			}
			for (const observation of operatorObservations) {
				if (observation.sourceId !== sourceId) continue;
				const work = discovered.get(observation.workKey);
				if (work === undefined) continue;
				const {
					sourceId: _sourceId,
					workKey: _workKey,
					...action
				} = observation;
				await options.runtime.operatorAction?.({ work, ...action });
			}
			const cancelledIds = new Set<string>();
			if (found !== undefined) {
				const next = new Map<string, PlotExtensionWork>();
				for (const work of found) {
					const key = workKeyForExtensionWork(options.extension, work);
					if (completedSinceReconcile.has(key)) continue;
					if (work.status === "cancelled") {
						cancelledIds.add(work.id);
						continue;
					}
					next.set(key, work);
				}
				discovered = next;
				for (const key of retries.keys())
					if (!discovered.has(key) && !completedSinceReconcile.has(key))
						retries.delete(key);
				completedSinceReconcile.clear();
			}
			const cancel = activeRuns.flatMap((active) =>
				cancelledIds.has(extensionWork(active.work).id)
					? [
							{
								workKey: active.run.workKey,
								reason: `work was cancelled by source ${sourceId}`,
							},
						]
					: [],
			);
			const claimedIds = new Set(
				activeRuns.map((active) => extensionWork(active.work).id),
			);
			const now = Date.now();
			const dispatch =
				currentSource.readiness !== "ready"
					? []
					: [...discovered].flatMap(([key, work]) => {
							const retry = retries.get(key);
							if (
								work.status === "blocked" ||
								work.status === "waiting" ||
								claimedIds.has(work.id) ||
								(retry !== undefined && retry.dueAtMs > now)
							)
								return [];
							return [workItem(options.extension, options.workflow, work)];
						});
			return {
				source: currentSource,
				work: [...discovered.values()].map((work) =>
					workRecord(options.extension, sourceId, work),
				),
				dispatch,
				cancel,
				wakes: pendingWakes.splice(0),
			};
		},
		started: async ({ run, work: item }) => {
			const work = extensionWork(item);
			if (work.workspace !== undefined)
				await mkdir(work.workspace, { recursive: true });
			await options.runtime.started?.({ work, runId: run.runId });
		},
		finished: async ({ run, work: item, completion }) => {
			const work = extensionWork(item);
			completedSinceReconcile.add(run.workKey);
			if (completion.status === "failed" || completion.status === "timed_out") {
				const previous = retries.get(run.workKey);
				const attempt = (previous?.attempt ?? 0) + 1;
				const delayMs = retryDelayMs(attempt);
				retries.set(run.workKey, { attempt, dueAtMs: Date.now() + delayMs });
				pendingWakes.push({
					delayMs,
					workKey: run.workKey,
					attempt,
					reason: `retry backoff after ${completion.status} run`,
				});
			} else retries.delete(run.workKey);
			await options.runtime.finished?.({
				work,
				runId: run.runId,
				completion: runCompletion(completion),
			});
		},
		continueWork: ({ run }) => {
			const work = discovered.get(run.workKey);
			return (
				currentSource.readiness === "ready" &&
				work !== undefined &&
				work.status !== "blocked" &&
				work.status !== "waiting"
			);
		},
	};

	const startAction: PlotExtensionSourceBundle["startAction"] = async (
		input,
	) => {
		if (
			[...actions.values()].some(
				(action) => action.requirementId === input.requirementId,
			)
		)
			return { accepted: false };
		const action = requirements.find(
			(candidate) => candidate.id === input.requirementId,
		)?.action;
		const state = currentSource.requirements.find(
			(candidate) => candidate.id === input.requirementId,
		);
		if (
			action === undefined ||
			state?.status !== "action-required" ||
			!state.actions.some((candidate) => candidate.id === input.actionId)
		)
			return { accepted: false };
		const actionRunId = `source-action-${randomUUID()}`;
		await input.events.started(actionRunId);
		const controller = new AbortController();
		const callbacks = new Set<{ readonly cancel: () => void }>();
		const interaction: ExtensionInteraction = {
			openUrl: async (url, fallbackText) => {
				await input.events.openUrl(actionRunId, url, fallbackText);
			},
			createOAuthCallback: async (timeoutMs) => {
				const callback = await createLoopbackOAuthCallback(timeoutMs);
				callbacks.add(callback);
				return callback;
			},
			reportProgress: async (message) => {
				await input.events.progress(actionRunId, message);
			},
		};
		const promise = (async () => {
			try {
				await action({
					actionId: input.actionId,
					signal: controller.signal,
					credentials,
					interaction,
				});
				if (controller.signal.aborted) {
					await input.events.cancelled(actionRunId);
					return;
				}
				forcedAction = undefined;
				await input.events.completed(
					actionRunId,
					await check(controller.signal),
				);
			} catch (error) {
				if (controller.signal.aborted)
					await input.events.cancelled(actionRunId);
				else await input.events.failed(actionRunId, errorMessage(error));
			} finally {
				for (const callback of callbacks) callback.cancel();
				actions.delete(actionRunId);
			}
		})();
		actions.set(actionRunId, {
			requirementId: input.requirementId,
			controller,
			promise,
		});
		return { accepted: true, actionRunId };
	};

	let shutdownPromise: Promise<void> | undefined;
	return {
		source,
		startAction,
		cancelAction: (actionRunId) => {
			const action = actions.get(actionRunId);
			if (action === undefined) return false;
			action.controller.abort();
			return true;
		},
		createOptions: async (context) => {
			const work = extensionWork(context.work);
			const customTools = options.runtime.tools?.length
				? await resolveToolDefinitions({
						tools: options.runtime.tools,
						workflow: options.workflow,
						paths: options.paths,
						config: options.config,
						work,
						runId: context.run.runId,
						onError: (error) => {
							if (!(error instanceof ExtensionActionRequiredError)) return;
							forcedAction = {
								requirementId: error.requirementId,
								message: error.message,
							};
						},
					})
				: [];
			return { customTools, cwd: work.workspace };
		},
		shutdown: () => {
			shutdownPromise ??= (async () => {
				for (const action of actions.values()) action.controller.abort();
				const joined = Promise.allSettled(
					[...actions.values()].map((action) => action.promise),
				);
				let timeout: ReturnType<typeof setTimeout> | undefined;
				await Promise.race([
					joined,
					new Promise<void>((resolve) => {
						timeout = setTimeout(resolve, SOURCE_SHUTDOWN_MS);
						timeout.unref?.();
					}),
				]);
				if (timeout !== undefined) clearTimeout(timeout);
				const controller = new AbortController();
				await options.runtime.shutdown?.({ signal: controller.signal });
			})();
			return shutdownPromise;
		},
	};
};
