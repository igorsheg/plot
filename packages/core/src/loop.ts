import {
	Cause,
	Context,
	Effect,
	Exit,
	Layer,
	Option,
	Queue,
	Ref,
	Semaphore,
} from "effect";
import { withWideEvent } from "@plot/common/observability";
import type {
	ActionId,
	ActionRequest,
	AdmittedAction,
	CapabilityDefinition,
	CapabilityId,
	Completion,
	Diagnostic,
	HookPhase,
	IdempotencyKey,
	Observation,
	OrchestratorMessage,
	OrchestratorPolicy,
	PluginId,
	PlotPlugin,
	ReconcileProposal,
	RuntimeSnapshot,
	SubjectKey,
	TickResult,
} from "./plugin.js";

interface RuntimeState {
	readonly tickId: number;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly actionLedger: ReadonlyMap<IdempotencyKey, ActionId>;
	readonly nextActionIndex: number;
}

export interface OrchestratorShape {
	readonly tickOnce: () => Effect.Effect<TickResult>;
	readonly snapshot: () => Effect.Effect<RuntimeSnapshot>;
	readonly offer: (message: OrchestratorMessage) => Effect.Effect<boolean>;
}

export class Orchestrator extends Context.Service<
	Orchestrator,
	OrchestratorShape
>()("@plot/core/loop/Orchestrator") {}

export interface OrchestratorLayerOptions {
	readonly plugins: readonly PlotPlugin[];
	readonly capabilities?: readonly CapabilityDefinition[];
	readonly policy?: OrchestratorPolicy;
	readonly queueCapacity?: number;
}

const initialState: RuntimeState = {
	tickId: 0,
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	actionLedger: new Map(),
	nextActionIndex: 0,
};

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const hookDiagnostic = (
	phase: HookPhase,
	pluginId: PluginId,
	error: unknown,
): Diagnostic => ({
	level: "error",
	phase,
	pluginId,
	message: errorMessage(error),
});

const capabilityDiagnostic = (
	action: AdmittedAction,
	error: unknown,
): Diagnostic => ({
	level: "error",
	phase: "capability",
	pluginId: action.pluginId,
	capabilityId: action.capability,
	actionId: action.actionId,
	message: errorMessage(error),
});

const snapshotFrom = (state: RuntimeState): RuntimeSnapshot => ({
	tickId: state.tickId,
	facts: new Map(state.facts),
	observations: [...state.observations],
	completions: [...state.completions],
	diagnostics: [...state.diagnostics],
	actionLedger: new Map(state.actionLedger),
});

const drainMessages = (messages: readonly OrchestratorMessage[]) => {
	const observations: Observation[] = [];
	const completions: Completion[] = [];
	for (const message of messages) {
		if (message.type === "observation") {
			observations.push(message.observation);
		} else {
			completions.push(message.completion);
		}
	}
	return { observations, completions };
};

const applyProposals = (
	facts: ReadonlyMap<string, unknown>,
	proposals: readonly ReconcileProposal[],
): ReadonlyMap<string, unknown> => {
	const next = new Map(facts);
	for (const proposal of proposals) {
		if (proposal.type === "set_fact") {
			next.set(proposal.key, proposal.value);
		} else {
			next.delete(proposal.key);
		}
	}
	return next;
};

const pluginUses = (plugin: PlotPlugin): ReadonlySet<CapabilityId> =>
	new Set(plugin.manifest?.uses ?? []);

const hasGrant = (
	policy: OrchestratorPolicy,
	pluginId: PluginId,
	capabilityId: CapabilityId,
): boolean => new Set(policy.grants?.[pluginId] ?? []).has(capabilityId);

const actionSortKey = (action: ActionRequest): string =>
	[
		action.priority ?? Number.MAX_SAFE_INTEGER,
		action.subject ?? "",
		action.capability,
	]
		.map(String)
		.join("|");

const sortPlannedActions = (
	planned: readonly {
		readonly plugin: PlotPlugin;
		readonly action: ActionRequest;
	}[],
) =>
	planned.toSorted((left, right) => {
		const priority =
			(left.action.priority ?? Number.MAX_SAFE_INTEGER) -
			(right.action.priority ?? Number.MAX_SAFE_INTEGER);
		if (priority !== 0) return priority;
		const subject = (left.action.subject ?? "").localeCompare(
			right.action.subject ?? "",
		);
		if (subject !== 0) return subject;
		return actionSortKey(left.action).localeCompare(
			actionSortKey(right.action),
		);
	});

const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };

const optionalOutput = (output: unknown) =>
	output === undefined ? {} : { output };

const makeRejectedCompletion = (
	action: ActionRequest,
	pluginId: PluginId,
	index: number,
	error: string,
): Completion => ({
	actionId: `rejected-${pluginId}-${index}`,
	pluginId,
	capabilityId: action.capability,
	status: "rejected",
	...optionalSubject(action.subject),
	error,
});

const admitActions = (
	state: RuntimeState,
	plugins: readonly PlotPlugin[],
	capabilities: ReadonlyMap<CapabilityId, CapabilityDefinition>,
	policy: OrchestratorPolicy,
	planned: readonly {
		readonly plugin: PlotPlugin;
		readonly action: ActionRequest;
	}[],
) => {
	const admitted: AdmittedAction[] = [];
	const rejected: Completion[] = [];
	const diagnostics: Diagnostic[] = [];
	const ledger = new Map(state.actionLedger);
	let nextActionIndex = state.nextActionIndex;
	const usesByPlugin = new Map(
		plugins.map((plugin) => [plugin.id, pluginUses(plugin)]),
	);
	const maxActions = policy.maxActionsPerTick ?? 100;

	for (const { plugin, action } of sortPlannedActions(planned)) {
		const reject = (message: string) => {
			const completion = makeRejectedCompletion(
				action,
				plugin.id,
				nextActionIndex,
				message,
			);
			rejected.push(completion);
			diagnostics.push({
				level: "error",
				phase: "admit",
				pluginId: plugin.id,
				capabilityId: action.capability,
				message,
			});
		};

		if (admitted.length >= maxActions) {
			reject("max actions per tick reached");
			continue;
		}
		if (!capabilities.has(action.capability)) {
			reject("capability is not registered");
			continue;
		}
		if (!usesByPlugin.get(plugin.id)?.has(action.capability)) {
			reject("plugin did not declare capability use");
			continue;
		}
		if (!hasGrant(policy, plugin.id, action.capability)) {
			reject("plugin is not granted capability use");
			continue;
		}
		if (action.idempotencyKey && ledger.has(action.idempotencyKey)) {
			reject("idempotency key already admitted");
			continue;
		}

		const actionId = `action-${nextActionIndex}`;
		nextActionIndex += 1;
		if (action.idempotencyKey) ledger.set(action.idempotencyKey, actionId);
		admitted.push({ ...action, actionId, pluginId: plugin.id });
	}

	return { admitted, rejected, diagnostics, ledger, nextActionIndex };
};

const runPluginObserve = (plugin: PlotPlugin, snapshot: RuntimeSnapshot) => {
	if (!plugin.observeTick) return Effect.succeed([] as readonly Observation[]);
	return plugin
		.observeTick({ pluginId: plugin.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.catch((error) =>
				Effect.succeed([hookDiagnostic("observe", plugin.id, error)]),
			),
		);
};

const runPluginReconcile = (plugin: PlotPlugin, snapshot: RuntimeSnapshot) => {
	if (!plugin.reconcile)
		return Effect.succeed({
			proposals: [] as readonly ReconcileProposal[],
			diagnostics: [] as readonly Diagnostic[],
		});
	return plugin
		.reconcile({ pluginId: plugin.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.map((proposals) => ({
				proposals,
				diagnostics: [] as readonly Diagnostic[],
			})),
			Effect.catch((error) =>
				Effect.succeed({
					proposals: [] as readonly ReconcileProposal[],
					diagnostics: [hookDiagnostic("reconcile", plugin.id, error)],
				}),
			),
		);
};

const runPluginPlan = (plugin: PlotPlugin, snapshot: RuntimeSnapshot) => {
	if (!plugin.plan)
		return Effect.succeed({
			planned: [] as readonly ActionRequest[],
			diagnostics: [] as readonly Diagnostic[],
		});
	return plugin
		.plan({ pluginId: plugin.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.map((planned) => ({
				planned,
				diagnostics: [] as readonly Diagnostic[],
			})),
			Effect.catch((error) =>
				Effect.succeed({
					planned: [] as readonly ActionRequest[],
					diagnostics: [hookDiagnostic("plan", plugin.id, error)],
				}),
			),
		);
};

const executeAction = (
	tickId: number,
	capability: CapabilityDefinition,
	action: AdmittedAction,
): Effect.Effect<{
	readonly completion: Completion;
	readonly diagnostic?: Diagnostic;
}> =>
	withWideEvent(
		"orchestrator.action.execute",
		{
			tick_id: tickId,
			plugin_id: action.pluginId,
			capability_id: action.capability,
			action_id: action.actionId,
			subject: action.subject,
		},
		Effect.exit(
			capability.execute(
				{
					pluginId: action.pluginId,
					tickId,
					actionId: action.actionId,
					capabilityId: action.capability,
					...optionalSubject(action.subject),
				},
				action.input,
			),
		).pipe(
			Effect.map((exit) => {
				if (Exit.isSuccess(exit)) {
					return {
						completion: {
							actionId: action.actionId,
							pluginId: action.pluginId,
							capabilityId: action.capability,
							status: "succeeded",
							...optionalSubject(action.subject),
							...optionalOutput(exit.value),
						},
					};
				}
				const error = Cause.pretty(exit.cause);
				return {
					completion: {
						actionId: action.actionId,
						pluginId: action.pluginId,
						capabilityId: action.capability,
						status: "failed",
						...optionalSubject(action.subject),
						error,
					},
					diagnostic: capabilityDiagnostic(action, error),
				};
			}),
		),
	);

export const makeOrchestratorLayer = (options: OrchestratorLayerOptions) => {
	const plugins = options.plugins;
	const capabilities = new Map(
		(options.capabilities ?? []).map((capability) => [
			capability.id,
			capability,
		]),
	);
	const policy = options.policy ?? {};

	return Layer.effect(
		Orchestrator,
		Effect.gen(function* () {
			const stateRef = yield* Ref.make(initialState);
			const queue = yield* Queue.bounded<OrchestratorMessage>(
				options.queueCapacity ?? 64,
			);
			const tickLock = yield* Semaphore.make(1);

			const snapshot = () => Ref.get(stateRef).pipe(Effect.map(snapshotFrom));

			const tickOnce = () =>
				tickLock.withPermits(1)(
					withWideEvent(
						"orchestrator.tick",
						{},
						Effect.gen(function* () {
							const messages: OrchestratorMessage[] = [];
							let draining = true;
							while (draining) {
								const message = yield* Queue.poll(queue);
								if (Option.isSome(message)) {
									messages.push(message.value);
								} else {
									draining = false;
								}
							}
							const drained = drainMessages(messages);
							const starting = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									tickId: state.tickId + 1,
									observations: [
										...state.observations,
										...drained.observations,
									],
									completions: [...state.completions, ...drained.completions],
								};
								return [next, next] as const;
							});
							const tickId = starting.tickId;

							const observeResults = yield* Effect.forEach(plugins, (plugin) =>
								runPluginObserve(plugin, snapshotFrom(starting)),
							);
							const observeDiagnostics = observeResults
								.flat()
								.filter((item): item is Diagnostic => "level" in item);
							const observations = observeResults
								.flat()
								.filter((item): item is Observation => !("level" in item));

							const afterObserve = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									observations: [...state.observations, ...observations],
									diagnostics: [...state.diagnostics, ...observeDiagnostics],
								};
								return [next, next] as const;
							});

							const reconcileResults = yield* Effect.forEach(
								plugins,
								(plugin) =>
									runPluginReconcile(plugin, snapshotFrom(afterObserve)),
							);
							const proposals = reconcileResults.flatMap(
								(result) => result.proposals,
							);
							const reconcileDiagnostics = reconcileResults.flatMap(
								(result) => result.diagnostics,
							);
							const afterReconcile = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									facts: applyProposals(state.facts, proposals),
									observations: [],
									completions: [],
									diagnostics: [...state.diagnostics, ...reconcileDiagnostics],
								};
								return [next, next] as const;
							});

							const policyDiagnostics = policy.validate
								? yield* policy.validate(snapshotFrom(afterReconcile)).pipe(
										Effect.catch((error) =>
											Effect.succeed([
												{
													level: "error" as const,
													phase: "policy" as const,
													message: errorMessage(error),
												},
											]),
										),
									)
								: [];

							if (policyDiagnostics.length > 0) {
								yield* Ref.update(stateRef, (state) => ({
									...state,
									diagnostics: [...state.diagnostics, ...policyDiagnostics],
								}));
							}

							const policyFailed = policyDiagnostics.some(
								(diagnostic) => diagnostic.level === "error",
							);
							if (policyFailed) {
								const current = yield* Ref.get(stateRef);
								return {
									tickId,
									observations,
									proposals,
									planned: [],
									admitted: [],
									completions: [],
									diagnostics: [
										...observeDiagnostics,
										...reconcileDiagnostics,
										...policyDiagnostics,
									],
									snapshot: snapshotFrom(current),
								};
							}

							const planSnapshot = yield* snapshot();
							const planResults = yield* Effect.forEach(plugins, (plugin) =>
								runPluginPlan(plugin, planSnapshot).pipe(
									Effect.map((result) => ({ plugin, result })),
								),
							);
							const planDiagnostics = planResults.flatMap(
								({ result }) => result.diagnostics,
							);
							const plannedWithPlugins = planResults.flatMap(
								({ plugin, result }) =>
									result.planned.map((action) => ({ plugin, action })),
							);
							const planned = plannedWithPlugins.map(({ action }) => action);
							const preAdmissionState = yield* Ref.get(stateRef);
							const admittedResult = admitActions(
								preAdmissionState,
								plugins,
								capabilities,
								policy,
								plannedWithPlugins,
							);

							yield* Ref.update(stateRef, (state) => ({
								...state,
								actionLedger: admittedResult.ledger,
								nextActionIndex: admittedResult.nextActionIndex,
								diagnostics: [
									...state.diagnostics,
									...planDiagnostics,
									...admittedResult.diagnostics,
								],
							}));

							const executed = yield* Effect.forEach(
								admittedResult.admitted,
								(action) =>
									executeAction(
										tickId,
										capabilities.get(action.capability)!,
										action,
									),
							);
							const actionCompletions = executed.map(
								(result) => result.completion,
							);
							const actionDiagnostics = executed.flatMap((result) =>
								result.diagnostic ? [result.diagnostic] : [],
							);
							const completions = [
								...admittedResult.rejected,
								...actionCompletions,
							];
							const finalState = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									completions: [...state.completions, ...completions],
									diagnostics: [...state.diagnostics, ...actionDiagnostics],
								};
								return [next, next] as const;
							});

							return {
								tickId,
								observations,
								proposals,
								planned,
								admitted: admittedResult.admitted,
								completions,
								diagnostics: [
									...observeDiagnostics,
									...reconcileDiagnostics,
									...policyDiagnostics,
									...planDiagnostics,
									...admittedResult.diagnostics,
									...actionDiagnostics,
								],
								snapshot: snapshotFrom(finalState),
							};
						}),
					),
				);

			return {
				tickOnce,
				snapshot,
				offer: (message) => Queue.offer(queue, message),
			} satisfies OrchestratorShape;
		}),
	);
};
