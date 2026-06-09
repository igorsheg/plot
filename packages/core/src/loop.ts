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
	Completion,
	Diagnostic,
	HookPhase,
	Observation,
	OrchestratorMessage,
	PluginActResult,
	PluginId,
	PluginRun,
	ReconcileProposal,
	RuntimeSnapshot,
	RunId,
	SubjectKey,
	TickResult,
} from "./domain.js";
import type { OrchestratorPolicy, PlotPlugin } from "./plugin.js";

interface RuntimeState {
	readonly tickId: Domain.TickId;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly running: ReadonlyMap<PluginId, RunId>;
	readonly nextRunIndex: number;
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
	readonly policy?: OrchestratorPolicy;
	readonly queueCapacity?: number;
}

const initialState: RuntimeState = {
	tickId: Domain.tickId(0),
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	running: new Map(),
	nextRunIndex: 0,
};

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };

const optionalOutput = (output: unknown) =>
	output === undefined ? {} : { output };

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

const actDiagnostic = (completion: Completion): Diagnostic | undefined => {
	if (completion.status !== "failed") return undefined;
	return {
		level: "error",
		phase: "act",
		pluginId: completion.pluginId,
		runId: completion.runId,
		message: completion.error ?? "plugin act failed",
	};
};

const snapshotFrom = (state: RuntimeState): RuntimeSnapshot => ({
	tickId: state.tickId,
	facts: new Map(state.facts),
	observations: [...state.observations],
	completions: [...state.completions],
	diagnostics: [...state.diagnostics],
	running: new Map(state.running),
});

const drainMessages = (messages: readonly OrchestratorMessage[]) => {
	const observations: Observation[] = [];
	const completions: Completion[] = [];
	const finishedRuns: PluginRun[] = [];
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") {
			observations.push(message.observation);
		} else if (message.type === "completion") {
			completions.push(message.completion);
		} else if (message.type === "run_finished") {
			finishedRuns.push(message.run);
			if (message.completion) completions.push(message.completion);
		} else if (message.type === "shutdown") {
			shutdownRequested = true;
		}
	}
	return { observations, completions, finishedRuns, shutdownRequested };
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

const decodeObservations = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.Observation))(value);

const decodeProposals = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.ReconcileProposal))(value);

const decodeActResult = (value: unknown) =>
	Schema.decodeUnknownEffect(Domain.PluginActResult)(value);

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

const completionFromActResult = (
	run: PluginRun,
	result: PluginActResult,
): Completion | undefined => {
	if (result.type === "idle") return undefined;
	return {
		runId: run.runId,
		pluginId: run.pluginId,
		status: "succeeded",
		...optionalSubject(result.subject),
		...optionalOutput(result.output),
	};
};

const executePluginAct = (
	plugin: PlotPlugin,
	snapshot: RuntimeSnapshot,
	run: PluginRun,
	mailbox: Queue.Enqueue<OrchestratorMessage>,
) =>
	Effect.gen(function* () {
		if (!plugin.act) return;
		const startedAt = yield* Clock.currentTimeMillis;
		const fields = {
			operation: "orchestrator.plugin.act",
			plugin_id: plugin.id,
			run_id: run.runId,
			tick_id: snapshot.tickId,
		};
		const exit = yield* Effect.exit(
			plugin
				.act({ pluginId: plugin.id, tickId: snapshot.tickId, snapshot })
				.pipe(Effect.flatMap(decodeActResult)),
		);
		const duration_ms = (yield* Clock.currentTimeMillis) - startedAt;
		if (Exit.isSuccess(exit)) {
			const completion = completionFromActResult(run, exit.value);
			yield* logWideEvent({
				...fields,
				outcome: "success",
				status: exit.value.type,
				duration_ms,
			});
			yield* Queue.offer(mailbox, {
				type: "run_finished",
				run,
				...(completion ? { completion } : {}),
			});
			return;
		}
		const error = Cause.pretty(exit.cause);
		const completion: Completion = {
			runId: run.runId,
			pluginId: run.pluginId,
			status: "failed",
			error,
		};
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
		yield* Queue.offer(mailbox, {
			type: "run_finished",
			run,
			completion,
		});
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

const selectablePlugins = (
	plugins: readonly PlotPlugin[],
	running: ReadonlyMap<PluginId, RunId>,
) => plugins.filter((plugin) => plugin.act && !running.has(plugin.id));

export const makeOrchestratorLayer = (options: OrchestratorLayerOptions) => {
	const plugins = options.plugins;
	const policy = options.policy ?? {};

	return Layer.effect(
		Orchestrator,
		Effect.gen(function* () {
			yield* ensureUniquePlugins(plugins);
			const queueCapacity = yield* decodePositiveInt(
				options.queueCapacity ?? 64,
				"queueCapacity must be a positive integer",
			);
			if (policy.maxConcurrentRuns !== undefined) {
				yield* decodePositiveInt(
					policy.maxConcurrentRuns,
					"maxConcurrentRuns must be a positive integer",
				);
			}
			const stateRef = yield* Ref.make(initialState);
			const snapshotRef = yield* Ref.make(snapshotFrom(initialState));
			const mailbox = yield* Queue.bounded<OrchestratorMessage>(queueCapacity);
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
					const message = yield* Queue.poll(mailbox);
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
									const diagnostic = actDiagnostic(completion);
									return diagnostic ? [diagnostic] : [];
								},
							);
							const starting = yield* Ref.modify(stateRef, (state) => {
								const running = new Map(state.running);
								for (const run of drained.finishedRuns) {
									if (running.get(run.pluginId) === run.runId) {
										running.delete(run.pluginId);
									}
								}
								const next = {
									...state,
									tickId: Domain.tickId(state.tickId + 1),
									observations: [
										...state.observations,
										...drained.observations,
									],
									completions: [...state.completions, ...drained.completions],
									diagnostics: [...state.diagnostics, ...completionDiagnostics],
									running,
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
							if (policyFailed || drained.shutdownRequested) {
								const current = yield* Ref.get(stateRef);
								yield* publishSnapshot(current);
								return {
									shutdownRequested: drained.shutdownRequested,
									result: {
										tickId,
										observations,
										proposals,
										started: [],
										completions: drained.completions,
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

							const beforeAct = yield* Ref.get(stateRef);
							const maxRuns = policy.maxConcurrentRuns ?? 100;
							const capacity = Math.max(0, maxRuns - beforeAct.running.size);
							const selected = selectablePlugins(
								plugins,
								beforeAct.running,
							).slice(0, capacity);
							const { state: afterStart, started } = yield* Ref.modify(
								stateRef,
								(state) => {
									const running = new Map(state.running);
									const runs: PluginRun[] = [];
									let nextRunIndex = state.nextRunIndex;
									for (const selectedPlugin of selected) {
										const run = {
											runId: Domain.runId(`run-${nextRunIndex}`),
											pluginId: selectedPlugin.id,
										};
										nextRunIndex += 1;
										running.set(selectedPlugin.id, run.runId);
										runs.push(run);
									}
									const next = { ...state, running, nextRunIndex };
									return [{ state: next, started: runs }, next] as const;
								},
							);
							const actSnapshot = snapshotFrom(afterStart);
							yield* Effect.forEach(
								started,
								(run) => {
									const runPlugin = plugins.find(
										(candidate) => candidate.id === run.pluginId,
									)!;
									return executePluginAct(
										runPlugin,
										actSnapshot,
										run,
										mailbox,
									).pipe(
										Effect.ignore,
										Effect.forkIn(actionScope, { startImmediately: true }),
									);
								},
								{ discard: true },
							);

							yield* publishSnapshot(afterStart);
							return {
								shutdownRequested: drained.shutdownRequested,
								result: {
									tickId,
									observations,
									proposals,
									started,
									completions: drained.completions,
									diagnostics: [
										...completionDiagnostics,
										...observeDiagnostics,
										...reconcileDiagnostics,
										...policyDiagnostics,
									],
									snapshot: snapshotFrom(afterStart),
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
					Effect.flatMap((decoded) => Queue.offer(mailbox, decoded)),
					Effect.catch(() => Effect.succeed(false)),
				);
			});

			const run = Effect.fn("Orchestrator.run")(function* () {
				let running = true;
				while (running) {
					const message = yield* Queue.take(mailbox);
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
