import {
	Cause,
	Clock,
	Context,
	Effect,
	Exit,
	Fiber,
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
	InterruptWorkProposal,
	Observation,
	OrchestratorMessage,
	SourceId,
	ReconcileProposal,
	RuntimeSnapshot,
	SubjectKey,
	TickResult,
	WorkItem,
	WorkKey,
	WorkResult,
	WorkRun,
} from "./domain.js";
import type { WorkRunner } from "./runner.js";
import type { OrchestratorPolicy, WorkSource } from "./source.js";

interface RuntimeState {
	readonly tickId: Domain.TickId;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly running: ReadonlyMap<WorkKey, WorkRun>;
	readonly nextRunIndex: number;
}

type InternalMessage =
	| OrchestratorMessage
	| {
			readonly type: "run_completed";
			readonly run: WorkRun;
			readonly completion: Completion;
	  };

interface DrainedMessages {
	readonly observations: readonly Observation[];
	readonly completions: readonly {
		readonly run: WorkRun;
		readonly completion: Completion;
	}[];
	readonly shutdownRequested: boolean;
}

interface WorkSelection {
	readonly source: WorkSource;
	readonly work: WorkItem;
}

interface RunHandle {
	readonly run: WorkRun;
	readonly fiber: Fiber.Fiber<void>;
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
	readonly sources: readonly WorkSource[];
	readonly runner: WorkRunner;
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
	sourceId: SourceId,
	error: unknown,
): Diagnostic => ({
	level: "error",
	phase,
	sourceId,
	message: errorMessage(error),
});

const completionDiagnostic = (
	completion: Completion,
): Diagnostic | undefined => {
	if (completion.status === "succeeded") return undefined;
	return {
		level: completion.status === "interrupted" ? "warning" : "error",
		phase: "act",
		sourceId: completion.sourceId,
		runId: completion.runId,
		workKey: completion.workKey,
		message: completion.error ?? `work run ${completion.status}`,
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

const drainMessages = (
	messages: readonly InternalMessage[],
): DrainedMessages => {
	const observations: Observation[] = [];
	const completions: { run: WorkRun; completion: Completion }[] = [];
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") {
			observations.push(message.observation);
		} else if (message.type === "run_completed") {
			completions.push({ run: message.run, completion: message.completion });
		} else if (message.type === "shutdown") {
			shutdownRequested = true;
		}
	}
	return { observations, completions, shutdownRequested };
};

const applyFactProposals = (
	facts: ReadonlyMap<string, unknown>,
	proposals: readonly ReconcileProposal[],
): ReadonlyMap<string, unknown> => {
	const next = new Map(facts);
	for (const proposal of proposals) {
		if (proposal.type === "set_fact") {
			next.set(proposal.key, proposal.value);
		} else if (proposal.type === "remove_fact") {
			next.delete(proposal.key);
		}
	}
	return next;
};

const beginTick = (state: RuntimeState, drained: DrainedMessages) => {
	const running = new Map(state.running);
	const completions: Completion[] = [];
	const diagnostics: Diagnostic[] = [];

	for (const item of drained.completions) {
		const active = running.get(item.run.workKey);
		if (!active || active.runId !== item.run.runId) continue;
		running.delete(item.run.workKey);
		completions.push(item.completion);
		const diagnostic = completionDiagnostic(item.completion);
		if (diagnostic) diagnostics.push(diagnostic);
	}
	const completedRuns = drained.completions.map((item) => item.run);

	if (drained.shutdownRequested) {
		for (const run of running.values()) {
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "interrupted",
				...optionalSubject(run.subject),
				error: "work run interrupted by orchestrator shutdown",
			};
			running.delete(run.workKey);
			completedRuns.push(run);
			completions.push(completion);
			const diagnostic = completionDiagnostic(completion);
			if (diagnostic) diagnostics.push(diagnostic);
		}
	}

	const next = {
		...state,
		tickId: Domain.tickId(state.tickId + 1),
		observations: [...state.observations, ...drained.observations],
		completions: [...state.completions, ...completions],
		diagnostics: [...state.diagnostics, ...diagnostics],
		running,
	};
	return { state: next, completions, diagnostics, completedRuns };
};

const applyObserved = (
	state: RuntimeState,
	observations: readonly Observation[],
	diagnostics: readonly Diagnostic[],
): RuntimeState => ({
	...state,
	observations: [...state.observations, ...observations],
	diagnostics: [...state.diagnostics, ...diagnostics],
});

const applyReconciled = (
	state: RuntimeState,
	proposals: readonly ReconcileProposal[],
	diagnostics: readonly Diagnostic[],
): RuntimeState => ({
	...state,
	facts: applyFactProposals(state.facts, proposals),
	observations: [],
	completions: [],
	diagnostics: [...state.diagnostics, ...diagnostics],
});

const applyDiagnostics = (
	state: RuntimeState,
	diagnostics: readonly Diagnostic[],
): RuntimeState => ({
	...state,
	diagnostics: [...state.diagnostics, ...diagnostics],
});

const interruptRunningWork = (
	state: RuntimeState,
	proposals: readonly InterruptWorkProposal[],
) => {
	const running = new Map(state.running);
	const completions: Completion[] = [];
	const diagnostics: Diagnostic[] = [];
	const interruptedRuns: WorkRun[] = [];
	const interruptedKeys = new Set<WorkKey>();

	for (const proposal of proposals) {
		const run = running.get(proposal.workKey);
		if (!run) continue;
		running.delete(proposal.workKey);
		interruptedRuns.push(run);
		interruptedKeys.add(proposal.workKey);
		const completion: Completion = {
			runId: run.runId,
			sourceId: run.sourceId,
			workKey: run.workKey,
			status: "interrupted",
			...optionalSubject(run.subject),
			error: proposal.reason ?? "work run interrupted by source proposal",
		};
		completions.push(completion);
		const diagnostic = completionDiagnostic(completion);
		if (diagnostic) diagnostics.push(diagnostic);
	}

	return {
		state: {
			...state,
			completions: [...state.completions, ...completions],
			diagnostics: [...state.diagnostics, ...diagnostics],
			running,
		},
		completions,
		diagnostics,
		interruptedRuns,
		interruptedKeys,
	};
};

const decodeObservations = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.Observation))(value);

const decodeProposals = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.ReconcileProposal))(value);

const decodeWorkItems = (value: unknown) =>
	Schema.decodeUnknownEffect(Schema.Array(Domain.WorkItem))(value);

const decodeWorkResult = (value: unknown) =>
	Schema.decodeUnknownEffect(Domain.WorkResult)(value);

const runSourceObserve = (source: WorkSource, snapshot: RuntimeSnapshot) => {
	if (!source.observeTick) return Effect.succeed([] as readonly Observation[]);
	return source
		.observeTick({ sourceId: source.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.flatMap(decodeObservations),
			Effect.catch((error) =>
				Effect.succeed([hookDiagnostic("observe", source.id, error)]),
			),
		);
};

const runSourceReconcile = (source: WorkSource, snapshot: RuntimeSnapshot) => {
	if (!source.reconcile)
		return Effect.succeed({
			proposals: [] as readonly ReconcileProposal[],
			diagnostics: [] as readonly Diagnostic[],
		});
	return source
		.reconcile({ sourceId: source.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.flatMap(decodeProposals),
			Effect.map((proposals) => ({
				proposals,
				diagnostics: [] as readonly Diagnostic[],
			})),
			Effect.catch((error) =>
				Effect.succeed({
					proposals: [] as readonly ReconcileProposal[],
					diagnostics: [hookDiagnostic("reconcile", source.id, error)],
				}),
			),
		);
};

const runSourceSelectWork = (source: WorkSource, snapshot: RuntimeSnapshot) => {
	if (!source.selectWork)
		return Effect.succeed({
			selected: [] as readonly WorkSelection[],
			diagnostics: [] as readonly Diagnostic[],
		});
	return source
		.selectWork({ sourceId: source.id, tickId: snapshot.tickId, snapshot })
		.pipe(
			Effect.flatMap(decodeWorkItems),
			Effect.map((items) => ({
				selected: items.map((work) => ({ source, work })),
				diagnostics: [] as readonly Diagnostic[],
			})),
			Effect.catch((error) =>
				Effect.succeed({
					selected: [] as readonly WorkSelection[],
					diagnostics: [hookDiagnostic("select", source.id, error)],
				}),
			),
		);
};

const completionFromWorkResult = (
	run: WorkRun,
	result: WorkResult,
): Completion => ({
	runId: run.runId,
	sourceId: run.sourceId,
	workKey: run.workKey,
	status: "succeeded",
	...optionalSubject(run.subject),
	...optionalOutput(result.output),
});

const executeWorkRun = (
	runner: WorkRunner,
	snapshot: RuntimeSnapshot,
	selection: WorkSelection,
	run: WorkRun,
	mailbox: Queue.Enqueue<InternalMessage>,
) =>
	Effect.gen(function* () {
		const startedAt = yield* Clock.currentTimeMillis;
		const fields = {
			operation: "orchestrator.work.run",
			source_id: selection.source.id,
			run_id: run.runId,
			work_key: run.workKey,
			tick_id: snapshot.tickId,
			...optionalSubject(run.subject),
		};
		const emitObservation = (observation: Observation) => {
			const withSubject =
				observation.subject === undefined && run.subject !== undefined
					? { ...observation, subject: run.subject }
					: observation;
			return Schema.decodeUnknownEffect(Domain.Observation)(withSubject).pipe(
				Effect.flatMap((decoded) =>
					Queue.offer(mailbox, { type: "observation", observation: decoded }),
				),
				Effect.catch(() => Effect.succeed(false)),
			);
		};
		const exit = yield* Effect.exit(
			runner
				.run({
					sourceId: selection.source.id,
					tickId: snapshot.tickId,
					run,
					work: selection.work,
					snapshot,
					emitObservation,
				})
				.pipe(Effect.flatMap(decodeWorkResult)),
		);
		const duration_ms = (yield* Clock.currentTimeMillis) - startedAt;
		if (Exit.isSuccess(exit)) {
			const completion = completionFromWorkResult(run, exit.value);
			yield* logWideEvent({
				...fields,
				outcome: "success",
				status: "succeeded",
				duration_ms,
			});
			yield* Queue.offer(mailbox, {
				type: "run_completed",
				run,
				completion,
			});
			return;
		}
		const cause = exit.cause;
		const interrupted = Cause.hasInterrupts(cause);
		const error = interrupted ? "work run interrupted" : Cause.pretty(cause);
		const completion: Completion = {
			runId: run.runId,
			sourceId: run.sourceId,
			workKey: run.workKey,
			status: interrupted ? "interrupted" : "failed",
			...optionalSubject(run.subject),
			error,
		};
		yield* logWideEvent(
			{
				...fields,
				outcome: "error",
				status: completion.status,
				error,
				duration_ms,
			},
			"error",
		);
		yield* Queue.offer(mailbox, {
			type: "run_completed",
			run,
			completion,
		});
	});

const ensureUniqueSources = (sources: readonly WorkSource[]) =>
	Effect.gen(function* () {
		const seen = new Set<SourceId>();
		for (const source of sources) {
			if (seen.has(source.id)) {
				return yield* new Domain.PlotLoopError({
					phase: "setup",
					source_id: source.id,
					message: `duplicate source id: ${source.id}`,
				});
			}
			seen.add(source.id);
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

const sortSelectedWork = (selected: readonly WorkSelection[]) =>
	selected.toSorted((left, right) =>
		String(left.work.workKey).localeCompare(String(right.work.workKey)),
	);

const startEligibleRuns = (
	state: RuntimeState,
	selected: readonly WorkSelection[],
	maxConcurrentRuns: number,
	blockedThisTick: ReadonlySet<WorkKey> = new Set(),
) => {
	const running = new Map(state.running);
	const started: { run: WorkRun; selection: WorkSelection }[] = [];
	const seen = new Set<WorkKey>();
	let nextRunIndex = state.nextRunIndex;
	const capacity = Math.max(0, maxConcurrentRuns - running.size);

	for (const selection of sortSelectedWork(selected)) {
		if (started.length >= capacity) break;
		const { work } = selection;
		if (seen.has(work.workKey)) continue;
		seen.add(work.workKey);
		if (blockedThisTick.has(work.workKey)) continue;
		if (running.has(work.workKey)) continue;
		const run: WorkRun = {
			runId: Domain.runId(`run-${nextRunIndex}`),
			sourceId: selection.source.id,
			workKey: work.workKey,
			...optionalSubject(work.subject),
		};
		nextRunIndex += 1;
		running.set(work.workKey, run);
		started.push({ run, selection });
	}

	return {
		state: { ...state, running, nextRunIndex },
		started,
	};
};

export const makeOrchestratorLayer = (options: OrchestratorLayerOptions) => {
	const sources = options.sources;
	const runner = options.runner;
	const policy = options.policy ?? {};

	return Layer.effect(
		Orchestrator,
		Effect.gen(function* () {
			yield* ensureUniqueSources(sources);
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
			const mailbox = yield* Queue.bounded<InternalMessage>(queueCapacity);
			const tickLock = yield* Semaphore.make(1);
			const actorScope = yield* Scope.make();
			const actionScope = yield* Scope.make();
			const runHandles = yield* Ref.make(new Map<WorkKey, RunHandle>());
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

			const interruptRunHandles = Effect.fn("Orchestrator.interruptRunHandles")(
				function* (runs: readonly WorkRun[]) {
					const handles = yield* Ref.modify(runHandles, (current) => {
						const next = new Map(current);
						const matched: RunHandle[] = [];
						for (const run of runs) {
							const handle = next.get(run.workKey);
							if (!handle || handle.run.runId !== run.runId) continue;
							next.delete(run.workKey);
							matched.push(handle);
						}
						return [matched, next] as const;
					});
					yield* Effect.forEach(
						handles,
						(handle) => Fiber.interrupt(handle.fiber),
						{ discard: true },
					);
				},
			);

			const collectQueuedMessages = Effect.fn(
				"Orchestrator.collectQueuedMessages",
			)(function* (initialMessages: readonly InternalMessage[]) {
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
				initialMessages: readonly InternalMessage[] = [],
			) {
				return yield* tickLock.withPermits(1)(
					withWideEvent(
						"orchestrator.tick",
						{},
						Effect.gen(function* () {
							const messages = yield* collectQueuedMessages(initialMessages);
							const drained = drainMessages(messages);
							const began = yield* Ref.modify(stateRef, (state) => {
								const result = beginTick(state, drained);
								return [result, result.state] as const;
							});
							const tickId = began.state.tickId;
							yield* interruptRunHandles(began.completedRuns);

							const observeResults = yield* Effect.forEach(sources, (source) =>
								runSourceObserve(source, snapshotFrom(began.state)),
							);
							const observeDiagnostics = observeResults
								.flat()
								.filter((item): item is Diagnostic => "level" in item);
							const observations = observeResults
								.flat()
								.filter((item): item is Observation => !("level" in item));

							const afterObserve = yield* Ref.modify(stateRef, (state) => {
								const next = applyObserved(
									state,
									observations,
									observeDiagnostics,
								);
								return [next, next] as const;
							});

							const reconcileResults = yield* Effect.forEach(
								sources,
								(source) =>
									runSourceReconcile(source, snapshotFrom(afterObserve)),
							);
							const proposals = reconcileResults.flatMap(
								(result) => result.proposals,
							);
							const reconcileDiagnostics = reconcileResults.flatMap(
								(result) => result.diagnostics,
							);
							yield* Ref.modify(stateRef, (state) => {
								const next = applyReconciled(
									state,
									proposals,
									reconcileDiagnostics,
								);
								return [next, next] as const;
							});
							const interruptProposals = proposals.filter(
								(proposal): proposal is InterruptWorkProposal =>
									proposal.type === "interrupt_work",
							);
							const interrupted = yield* Ref.modify(stateRef, (state) => {
								const result = interruptRunningWork(state, interruptProposals);
								return [result, result.state] as const;
							});
							yield* interruptRunHandles(interrupted.interruptedRuns);

							const policyDiagnostics = policy.validate
								? yield* policy.validate(snapshotFrom(interrupted.state)).pipe(
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
								yield* Ref.update(stateRef, (state) =>
									applyDiagnostics(state, policyDiagnostics),
								);
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
										selected: [],
										started: [],
										completions: [
											...began.completions,
											...interrupted.completions,
										],
										diagnostics: [
											...began.diagnostics,
											...observeDiagnostics,
											...reconcileDiagnostics,
											...interrupted.diagnostics,
											...policyDiagnostics,
										],
										snapshot: snapshotFrom(current),
									},
								};
							}

							const beforeSelect = yield* Ref.get(stateRef);
							const selectResults = yield* Effect.forEach(sources, (source) =>
								runSourceSelectWork(source, snapshotFrom(beforeSelect)),
							);
							const selectDiagnostics = selectResults.flatMap(
								(result) => result.diagnostics,
							);
							const selectedWithSources = selectResults.flatMap(
								(result) => result.selected,
							);
							const selected = selectedWithSources.map(({ work }) => work);
							if (selectDiagnostics.length > 0) {
								yield* Ref.update(stateRef, (state) =>
									applyDiagnostics(state, selectDiagnostics),
								);
							}

							const maxRuns = policy.maxConcurrentRuns ?? 100;
							const { state: afterStart, started } = yield* Ref.modify(
								stateRef,
								(state) => {
									const result = startEligibleRuns(
										state,
										selectedWithSources,
										maxRuns,
										interrupted.interruptedKeys,
									);
									return [result, result.state] as const;
								},
							);
							const runSnapshot = snapshotFrom(afterStart);
							yield* Effect.forEach(
								started,
								({ run, selection }) =>
									Effect.gen(function* () {
										const fiber = yield* executeWorkRun(
											runner,
											runSnapshot,
											selection,
											run,
											mailbox,
										).pipe(
											Effect.ignore,
											Effect.forkIn(actionScope, { startImmediately: true }),
										);
										yield* Ref.update(runHandles, (current) => {
											const next = new Map(current);
											next.set(run.workKey, { run, fiber });
											return next;
										});
									}),
								{ discard: true },
							);

							yield* publishSnapshot(afterStart);
							return {
								shutdownRequested: drained.shutdownRequested,
								result: {
									tickId,
									observations,
									proposals,
									selected,
									started: started.map(({ run }) => run),
									completions: [
										...began.completions,
										...interrupted.completions,
									],
									diagnostics: [
										...began.diagnostics,
										...observeDiagnostics,
										...reconcileDiagnostics,
										...interrupted.diagnostics,
										...policyDiagnostics,
										...selectDiagnostics,
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
