import {
	Cause,
	Clock,
	Context,
	Effect,
	Exit,
	Layer,
	Option,
	Queue,
	Ref,
	Schema,
	Scope,
	Semaphore,
} from "effect";
import { logWideEvent, withWideEvent } from "@plot/common/observability";
import * as Domain from "./domain.js";
import type {
	ActionId,
	ActionRequest,
	AdmittedAction,
	CapabilityId,
	Completion,
	Diagnostic,
	HookPhase,
	IdempotencyKey,
	Observation,
	OrchestratorMessage,
	PluginId,
	ReconcileProposal,
	RuntimeSnapshot,
	SubjectKey,
	TickId,
	TickResult,
} from "./domain.js";
import type {
	CapabilityDefinition,
	OrchestratorPolicy,
	PlotPlugin,
} from "./plugin.js";

interface RuntimeState {
	readonly tickId: TickId;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly actionLedger: ReadonlyMap<IdempotencyKey, ActionId>;
	readonly nextActionIndex: number;
}

export interface OrchestratorShape {
	readonly start: () => Effect.Effect<void>;
	readonly run: () => Effect.Effect<void>;
	readonly tickOnce: () => Effect.Effect<TickResult>;
	readonly snapshot: () => Effect.Effect<RuntimeSnapshot>;
	readonly offer: (message: OrchestratorMessage) => Effect.Effect<boolean>;
	readonly shutdown: () => Effect.Effect<boolean>;
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
	tickId: Domain.tickId(0),
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
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") {
			observations.push(message.observation);
		} else if (message.type === "completion") {
			completions.push(message.completion);
		} else if (message.type === "shutdown") {
			shutdownRequested = true;
		}
	}
	return { observations, completions, shutdownRequested };
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

const completionDiagnostic = (
	completion: Completion,
): Diagnostic | undefined => {
	if (completion.status !== "failed") return undefined;
	return {
		level: "error",
		phase: "capability",
		pluginId: completion.pluginId,
		capabilityId: completion.capabilityId,
		actionId: completion.actionId,
		message: completion.error ?? "capability failed",
	};
};

const makeRejectedCompletion = (
	action: ActionRequest,
	pluginId: PluginId,
	index: number,
	error: string,
): Completion => ({
	actionId: Domain.actionId(`rejected-${pluginId}-${index}`),
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

		const actionId = Domain.actionId(`action-${nextActionIndex}`);
		nextActionIndex += 1;
		if (action.idempotencyKey) ledger.set(action.idempotencyKey, actionId);
		admitted.push({ ...action, actionId, pluginId: plugin.id });
	}

	return { admitted, rejected, diagnostics, ledger, nextActionIndex };
};

const decodeObservations = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.Observation))(value);

const decodeProposals = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.ReconcileProposal))(value);

const decodeActions = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.ActionRequest))(value);

const decodeWithSchema = (
	schema: Schema.Decoder<unknown>,
	value: unknown,
): Effect.Effect<unknown, unknown> =>
	Effect.suspend(() => {
		const exit = Schema.decodeUnknownExit(schema)(value);
		if (Exit.isSuccess(exit)) return Effect.succeed(exit.value);
		return Effect.failCause(exit.cause);
	});

const runPluginObserve = (plugin: PlotPlugin, snapshot: RuntimeSnapshot) => {
	if (!plugin.observeTick) return Effect.succeed([] as readonly Observation[]);
	return plugin
		.observeTick({ pluginId: plugin.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.flatMap(decodeObservations),
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
			Effect.flatMap(decodeProposals),
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
			Effect.flatMap(decodeActions),
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
	tickId: TickId,
	capability: CapabilityDefinition,
	action: AdmittedAction,
): Effect.Effect<{
	readonly completion: Completion;
	readonly diagnostic?: Diagnostic;
}> =>
	Effect.gen(function* () {
		const startedAt = yield* Clock.currentTimeMillis;
		const fields = {
			operation: "orchestrator.action.execute",
			tick_id: tickId,
			plugin_id: action.pluginId,
			capability_id: action.capability,
			action_id: action.actionId,
			...optionalSubject(action.subject),
		};
		const exit = yield* Effect.exit(
			Effect.gen(function* () {
				const input = capability.input
					? yield* decodeWithSchema(capability.input, action.input)
					: action.input;
				const output = yield* capability.execute(
					{
						pluginId: action.pluginId,
						tickId,
						actionId: action.actionId,
						capabilityId: action.capability,
						...optionalSubject(action.subject),
					},
					input,
				);
				return capability.output
					? yield* decodeWithSchema(capability.output, output)
					: output;
			}),
		);
		const duration_ms = (yield* Clock.currentTimeMillis) - startedAt;
		if (Exit.isSuccess(exit)) {
			yield* logWideEvent({
				...fields,
				outcome: "success",
				status: "succeeded",
				duration_ms,
			});
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
		yield* logWideEvent(
			{
				...fields,
				outcome: "error",
				status: "failed",
				error,
				duration_ms,
			},
			"error",
		);
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
	});

const ensureUniquePlugins = (plugins: readonly PlotPlugin[]) =>
	Effect.gen(function* () {
		const seen = new Set<PluginId>();
		for (const plugin of plugins) {
			if (seen.has(plugin.id)) {
				return yield* new Domain.PlotLoopError({
					phase: "setup",
					plugin_id: plugin.id,
					message: `duplicate plugin id: ${plugin.id}`,
				});
			}
			seen.add(plugin.id);
		}
	});

const ensureUniqueCapabilities = (
	capabilities: readonly CapabilityDefinition[],
) =>
	Effect.gen(function* () {
		const seen = new Set<CapabilityId>();
		for (const capability of capabilities) {
			if (seen.has(capability.id)) {
				return yield* new Domain.PlotLoopError({
					phase: "setup",
					capability_id: capability.id,
					message: `duplicate capability id: ${capability.id}`,
				});
			}
			seen.add(capability.id);
		}
	});

const decodePositiveInt = (value: number, message: string) =>
	Schema.decodeUnknownEffect(Domain.PositiveInt)(value).pipe(
		Effect.mapError(
			() =>
				new Domain.PlotLoopError({
					phase: "setup",
					message,
				}),
		),
	);

export const makeOrchestratorLayer = (options: OrchestratorLayerOptions) => {
	const plugins = options.plugins;
	const rawCapabilities = options.capabilities ?? [];
	const policy = options.policy ?? {};

	return Layer.effect(
		Orchestrator,
		Effect.gen(function* () {
			yield* ensureUniquePlugins(plugins);
			yield* ensureUniqueCapabilities(rawCapabilities);
			const queueCapacity = yield* decodePositiveInt(
				options.queueCapacity ?? 64,
				"queueCapacity must be a positive integer",
			);
			if (policy.maxActionsPerTick !== undefined) {
				yield* decodePositiveInt(
					policy.maxActionsPerTick,
					"maxActionsPerTick must be a positive integer",
				);
			}
			const capabilities = new Map(
				rawCapabilities.map((capability) => [capability.id, capability]),
			);
			const stateRef = yield* Ref.make(initialState);
			const snapshotRef = yield* Ref.make(snapshotFrom(initialState));
			const queue = yield* Queue.bounded<OrchestratorMessage>(queueCapacity);
			const tickLock = yield* Semaphore.make(1);
			const actorScope = yield* Scope.make();
			const actionScope = yield* Scope.make();
			const actorStarted = yield* Ref.make(false);
			yield* Effect.addFinalizer((exit) =>
				Scope.close(actionScope, exit).pipe(
					Effect.andThen(Scope.close(actorScope, exit)),
				),
			);

			const publishSnapshot = (state: RuntimeState) =>
				Ref.set(snapshotRef, snapshotFrom(state));

			const snapshot = Effect.fn("Orchestrator.snapshot")(function* () {
				return yield* Ref.get(snapshotRef);
			});

			const collectQueuedMessages = Effect.fn(
				"Orchestrator.collectQueuedMessages",
			)(function* (initialMessages: readonly OrchestratorMessage[]) {
				const messages = [...initialMessages];
				let draining = true;
				while (draining) {
					const message = yield* Queue.poll(queue);
					if (Option.isSome(message)) {
						messages.push(message.value);
					} else {
						draining = false;
					}
				}
				return messages;
			});

			const runTick = Effect.fn("Orchestrator.runTick")(function* (
				initialMessages: readonly OrchestratorMessage[] = [],
			) {
				return yield* tickLock.withPermits(1)(
					withWideEvent(
						"orchestrator.tick",
						{},
						Effect.gen(function* () {
							const messages = yield* collectQueuedMessages(initialMessages);
							const drained = drainMessages(messages);
							const completionDiagnostics = drained.completions.flatMap(
								(completion) => {
									const diagnostic = completionDiagnostic(completion);
									return diagnostic ? [diagnostic] : [];
								},
							);
							const starting = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									tickId: Domain.tickId(state.tickId + 1),
									observations: [
										...state.observations,
										...drained.observations,
									],
									completions: [...state.completions, ...drained.completions],
									diagnostics: [...state.diagnostics, ...completionDiagnostics],
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
								yield* publishSnapshot(current);
								return {
									shutdownRequested: drained.shutdownRequested,
									result: {
										tickId,
										observations,
										proposals,
										planned: [],
										admitted: [],
										completions: [],
										diagnostics: [
											...completionDiagnostics,
											...observeDiagnostics,
											...reconcileDiagnostics,
											...policyDiagnostics,
										],
										snapshot: snapshotFrom(current),
									},
								};
							}

							const planSnapshot = snapshotFrom(afterReconcile);
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

							yield* Effect.forEach(
								admittedResult.admitted,
								(action) =>
									executeAction(
										tickId,
										capabilities.get(action.capability)!,
										action,
									).pipe(
										Effect.flatMap((result) =>
											Queue.offer(queue, {
												type: "completion",
												completion: result.completion,
											}),
										),
										Effect.ignore,
										Effect.forkIn(actionScope, { startImmediately: true }),
									),
								{ discard: true },
							);
							const completions = [
								...drained.completions,
								...admittedResult.rejected,
							];
							const finalState = yield* Ref.modify(stateRef, (state) => {
								const next = {
									...state,
									completions: [...state.completions, ...completions],
								};
								return [next, next] as const;
							});

							yield* publishSnapshot(finalState);
							return {
								shutdownRequested: drained.shutdownRequested,
								result: {
									tickId,
									observations,
									proposals,
									planned,
									admitted: admittedResult.admitted,
									completions,
									diagnostics: [
										...completionDiagnostics,
										...observeDiagnostics,
										...reconcileDiagnostics,
										...policyDiagnostics,
										...planDiagnostics,
										...admittedResult.diagnostics,
									],
									snapshot: snapshotFrom(finalState),
								},
							};
						}),
					),
				);
			});

			const tickOnce = Effect.fn("Orchestrator.tickOnce")(function* () {
				const tick = yield* runTick();
				return tick.result;
			});

			const offer = Effect.fn("Orchestrator.offer")(function* (
				message: OrchestratorMessage,
			) {
				return yield* Schema.decodeUnknownEffect(Domain.OrchestratorMessage)(
					message,
				).pipe(
					Effect.flatMap((decoded) => Queue.offer(queue, decoded)),
					Effect.catch(() => Effect.succeed(false)),
				);
			});

			const run = Effect.fn("Orchestrator.run")(function* () {
				let running = true;
				while (running) {
					const message = yield* Queue.take(queue);
					const tick = yield* runTick([message]);
					running = !tick.shutdownRequested;
				}
				yield* Scope.close(actionScope, Exit.void);
			});

			const start = Effect.fn("Orchestrator.start")(function* () {
				const alreadyStarted = yield* Ref.get(actorStarted);
				if (alreadyStarted) return;
				yield* Ref.set(actorStarted, true);
				yield* run().pipe(
					Effect.ensuring(Ref.set(actorStarted, false)),
					Effect.forkIn(actorScope, { startImmediately: true }),
					Effect.asVoid,
				);
			});

			const shutdown = Effect.fn("Orchestrator.shutdown")(function* () {
				return yield* offer({ type: "shutdown" });
			});

			return {
				start,
				run,
				tickOnce,
				snapshot,
				offer,
				shutdown,
			} satisfies OrchestratorShape;
		}),
	);
};
