import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type {
	Completion,
	OperatorObservation,
	SourceRecord,
	SourceRequirementRecord,
	SourceWorkRecord,
	WakeRequest,
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
	Extension,
	ExtensionRuntime,
	ExtensionWork,
	WorkSubject,
} from "@plot/sdk";
import type { OperatorObservationInput } from "@plot/sdk/work-contract";
import type { SourceActionStartResult } from "@plot/sdk/runtime-contract";
import type { SessionPaths } from "./paths.js";
import type { AgentSessionRunOptions } from "./agent-runner.js";
import { resolveToolDefinitions } from "./extension-tools.js";
import { createLoopbackOAuthCallback } from "./interaction.js";

const RETRY_BASE_DELAY_MS = 10_000;
const RETRY_MAX_DELAY_MS = 300_000;
const SOURCE_SHUTDOWN_MS = 5_000;
const DISCOVERED_WORK_CAPACITY = 1024;
const DISCOVERY_REQUIREMENT_ID = "plot:discovery";

export const sourceIdForExtension = (extension: Extension): string =>
	`extension:${encodeURIComponent(extension.id)}`;

export const workKeyForExtensionWork = (
	extension: Extension,
	work: ExtensionWork,
): string =>
	`extension:${JSON.stringify([extension.id, work.id, work.version ?? null])}`;

export const templateContextForWork = (
	workflow: unknown,
	work: ExtensionWork,
) => {
	const {
		context,
		status: _status,
		blockedReason: _reason,
		...metadata
	} = work;
	const definition = isRecord(workflow)
		? (workflow["config"] ?? workflow)
		: workflow;
	const base = { workflow: definition, work: metadata };
	if (context === undefined) return base;
	if (isRecord(context)) return { ...base, ...context };
	return { ...base, value: context };
};

const retryDelayMs = (attempt: number) =>
	Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);

const subjectFor = (work: ExtensionWork): WorkSubject =>
	typeof work.subject === "string"
		? { id: work.subject }
		: (work.subject ?? { id: work.id });

const subjectPresentation = (subject: WorkSubject): string =>
	JSON.stringify([
		subject.display?.kind ?? null,
		subject.display?.primary ?? null,
		subject.display?.title ?? null,
		subject.display?.subtitle ?? null,
		subject.display?.url ?? null,
		subject.display?.version ?? null,
		subject.display?.labels ?? [],
		subject.progress?.completed ?? null,
		subject.progress?.total ?? null,
		subject.progress?.phase ?? null,
	]);

const validateSubject = (work: ExtensionWork): void => {
	const subject = work.subject;
	if (subject === undefined) return;
	if (typeof subject === "string") {
		if (subject.length === 0)
			throw new Error(`work ${work.id} subject must be a non-empty string`);
		return;
	}
	if (
		!isRecord(subject) ||
		typeof subject.id !== "string" ||
		subject.id.length === 0
	)
		throw new Error(`work ${work.id} subject id must be a non-empty string`);
	const progress = subject.progress;
	if (progress === undefined) return;
	if (!isRecord(progress))
		throw new Error(
			`work ${work.id} subject progress must satisfy 0 <= completed <= total`,
		);
	const completed = progress.completed;
	const total = progress.total;
	if (
		typeof completed !== "number" ||
		!Number.isInteger(completed) ||
		completed < 0 ||
		typeof total !== "number" ||
		!Number.isInteger(total) ||
		total < 0 ||
		completed > total
	)
		throw new Error(
			`work ${work.id} subject progress must satisfy 0 <= completed <= total`,
		);
	if (
		progress.phase !== undefined &&
		(typeof progress.phase !== "string" || progress.phase.length === 0)
	)
		throw new Error(`work ${work.id} subject progress phase must be non-empty`);
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
	runtime: ExtensionRuntime,
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
	readonly extension: Extension;
	readonly runtime: ExtensionRuntime;
	readonly signal: AbortSignal;
}): Promise<readonly ExtensionWork[]> => {
	const value = await input.runtime.discover({ signal: input.signal });
	if (!Array.isArray(value)) throw new Error("discover must return an array");
	if (value.length > DISCOVERED_WORK_CAPACITY)
		throw new Error(
			`discover returned more than ${DISCOVERED_WORK_CAPACITY} Work Items`,
		);
	const keys = new Set<string>();
	const subjectPresentations = new Map<string, string>();
	for (const work of value) {
		if (typeof work.id !== "string" || work.id.length === 0)
			throw new Error("extension work id must be a non-empty string");
		if (work.workspace !== undefined && !isAbsolute(work.workspace))
			throw new Error(`work ${work.id} workspace must be an absolute path`);
		validateSubject(work);
		if (typeof work.subject === "object" && work.subject !== null) {
			const presentation = subjectPresentation(work.subject);
			const previous = subjectPresentations.get(work.subject.id);
			if (previous !== undefined && previous !== presentation)
				throw new Error(
					`subject ${work.subject.id} has conflicting presentation`,
				);
			subjectPresentations.set(work.subject.id, presentation);
		}
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

const extensionWork = (item: WorkItem): ExtensionWork =>
	item.sourceData as ExtensionWork;

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
	extension: Extension,
	sourceId: string,
	work: ExtensionWork,
): SourceWorkRecord => {
	const identity = {
		workKey: workKeyForExtensionWork(extension, work),
		sourceId,
		subject: subjectFor(work),
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
	extension: Extension,
	workflow: unknown,
	work: ExtensionWork,
): WorkItem => {
	return {
		workKey: workKeyForExtensionWork(extension, work),
		subject: subjectFor(work),
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

export interface ExtensionSource {
	readonly source: WorkSource;
	readonly startAction: (input: {
		readonly requirementId: string;
		readonly actionId: string;
		readonly events: SourceActionEvents;
	}) => Promise<SourceActionStartResult>;
	readonly cancelAction: (actionRunId: string) => boolean;
	readonly resolveOperatorAction: (
		input: OperatorObservationInput,
	) => Omit<OperatorObservation, "timestamp"> | undefined;
	readonly createOptions: (
		context: WorkRunnerContext,
	) => Promise<AgentSessionRunOptions>;
	readonly shutdown: () => Promise<void>;
}

interface ActiveAction {
	readonly requirementId: string;
	readonly controller: AbortController;
	readonly promise: Promise<void>;
}

export const makeExtensionSource = (options: {
	readonly extension: Extension;
	readonly runtime: ExtensionRuntime;
	readonly credentials: ExtensionCredentials;
	readonly workflow: unknown;
	readonly paths: SessionPaths;
	readonly config: unknown;
	readonly maxConcurrentRuns: number;
}): ExtensionSource => {
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
	let discovered = new Map<string, ExtensionWork>();
	const retries = new Map<string, { attempt: number; dueAtMs: number }>();
	const completedSinceReconcile = new Set<string>();
	const pendingWakes: WakeRequest[] = [];
	const actions = new Map<string, ActiveAction>();

	const resolveOperatorAction = (
		input: OperatorObservationInput,
	): Omit<OperatorObservation, "timestamp"> | undefined => {
		if (input.sourceId !== sourceId) return;
		const work = discovered.get(input.workKey);
		const action = work?.operatorActions?.find(
			(candidate) => candidate.id === input.actionId,
		);
		if (action === undefined || action.disabledReason !== undefined) return;
		if (
			action.requiresComment &&
			(input.comment === undefined || input.comment.trim().length === 0)
		)
			return;
		const observation: {
			sourceId: string;
			workKey: string;
			actionId: string;
			actionLabel: string;
			comment?: string;
			clientId?: string;
			actor?: unknown;
		} = {
			sourceId,
			workKey: input.workKey,
			actionId: action.id,
			actionLabel: action.label,
		};
		if (input.comment !== undefined) observation.comment = input.comment;
		if (input.clientId !== undefined) observation.clientId = input.clientId;
		if (input.actor !== undefined) observation.actor = input.actor;
		return observation;
	};

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
			let found: readonly ExtensionWork[] | undefined;
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
			let handledOperatorAction = false;
			for (const observation of operatorObservations) {
				const resolved = resolveOperatorAction(observation);
				if (resolved === undefined) continue;
				const work = discovered.get(resolved.workKey);
				if (work === undefined) continue;
				const { sourceId: _sourceId, workKey: _workKey, ...action } = resolved;
				await options.runtime.operatorAction?.({
					work,
					...action,
					timestamp: observation.timestamp,
				});
				handledOperatorAction = true;
			}
			if (handledOperatorAction)
				pendingWakes.push({
					delayMs: 0,
					reason: "reconcile after Operator action",
				});
			const cancelledIds = new Set<string>();
			if (found !== undefined) {
				const next = new Map<string, ExtensionWork>();
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

	const startAction: ExtensionSource["startAction"] = async (input) => {
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
		const selected =
			state?.status === "action-required"
				? state.actions.find((candidate) => candidate.id === input.actionId)
				: undefined;
		if (
			action === undefined ||
			selected === undefined ||
			selected.disabledReason !== undefined
		)
			return { accepted: false };
		const actionRunId = `source-action-${randomUUID()}`;
		await input.events.started(actionRunId);
		const controller = new AbortController();
		const callbacks = new Set<{ readonly cancel: () => void }>();
		const interaction: ExtensionInteraction = {
			openUrl: async (url, interactionOptions) => {
				await input.events.openUrl(
					actionRunId,
					url,
					interactionOptions?.fallbackText,
				);
			},
			createOAuthCallback: async (interactionOptions) => {
				const callback = await createLoopbackOAuthCallback(
					interactionOptions?.timeoutMs,
				);
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
		resolveOperatorAction,
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
