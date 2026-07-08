import { randomUUID } from "node:crypto";
import { AsyncQueue } from "@plot/common/async-queue";
import { EventHub } from "@plot/common/event-stream";
import { logWideEvent, withWideEvent } from "@plot/common/observability";
import { errorMessage } from "@plot/common/primitives";
import * as Domain from "./model.js";
import type {
	Completion,
	Diagnostic,
	HookPhase,
	InterruptWorkProposal,
	Observation,
	PlotAgentEvent,
	ReconcileProposal,
	RuntimeSnapshot,
	ScheduleWakeProposal,
	TickResult,
	WorkItem,
	WorkRecord,
	WorkRun,
} from "./model.js";
import type { PlotAgent, PlotAgentOptions } from "./agent.js";
import type { WorkRunnerContext } from "./work-runner.js";
import type { WorkSource } from "./work-source.js";
import {
	applyDiagnostics,
	applyObserved,
	applyReconciled,
	beginTick,
	boundStateHistory,
	type AgentLifecycle,
	type InternalMessage,
	type RunHandle,
	type RuntimeState,
	type TimedOutRun,
	type WorkSelection,
	completionDiagnostic,
	drainMessages,
	hookDiagnostic,
	initialRuntimeState,
	interruptRunningWork,
	snapshotFrom,
	startEligibleRuns,
	wakeScheduledEvent,
} from "./state.js";

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		let settled = false;
		const finish = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		const id = setTimeout(finish, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(id);
				finish();
			},
			{ once: true },
		);
	});
const positive = (
	value: number | undefined,
	fallback: number,
	message: string,
) => {
	const actual = value ?? fallback;
	if (!Number.isInteger(actual) || actual < 1)
		throw new Domain.PlotAgentError({ phase: "setup", message });
	return actual;
};

const noop = () => {};
const waitForAbort = (signal: AbortSignal) => {
	let cleanup = noop;
	const promise = new Promise<"aborted">((resolve) => {
		if (signal.aborted) {
			resolve("aborted");
			return;
		}
		const onAbort = () => resolve("aborted");
		cleanup = () => signal.removeEventListener("abort", onAbort);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	return { promise, cleanup };
};
export const makePlotAgentRuntime = (options: PlotAgentOptions): PlotAgent => {
	const sources = options.sources,
		runner = options.runner,
		policy = options.policy ?? {};
	const seen = new Set<string>();
	for (const source of sources) {
		if (seen.has(source.id))
			throw new Domain.PlotAgentError({
				phase: "setup",
				source_id: source.id,
				message: `duplicate source id: ${source.id}`,
			});
		seen.add(source.id);
	}
	const queueCapacity = positive(
			options.queueCapacity,
			64,
			"queueCapacity must be a positive integer",
		),
		eventCapacity = positive(
			options.eventCapacity,
			256,
			"eventCapacity must be a positive integer",
		),
		historyLimit = positive(
			options.historyLimit,
			256,
			"historyLimit must be a positive integer",
		);
	const tickIntervalMs = positive(
		options.tickIntervalMs,
		30_000,
		"tickIntervalMs must be a positive integer",
	);
	const maxRunDurationMs =
		options.maxRunDurationMs === undefined
			? undefined
			: positive(
					options.maxRunDurationMs,
					1,
					"maxRunDurationMs must be a positive integer",
				);
	const stallTimeoutMs =
		options.stallTimeoutMs === undefined
			? undefined
			: positive(
					options.stallTimeoutMs,
					1,
					"stallTimeoutMs must be a positive integer",
				);
	if (policy.maxConcurrentRuns !== undefined)
		positive(
			policy.maxConcurrentRuns,
			1,
			"maxConcurrentRuns must be a positive integer",
		);
	for (const source of sources)
		if (source.policy?.maxConcurrentRuns !== undefined)
			positive(
				source.policy.maxConcurrentRuns,
				1,
				`source ${source.id} maxConcurrentRuns must be a positive integer`,
			);
	const startingState = initialRuntimeState(`run-${randomUUID()}`);
	let state = startingState,
		snapshotCache = snapshotFrom(startingState),
		lifecycle: AgentLifecycle = "new",
		dispatchPaused = false,
		activeTickToken: number | undefined,
		nextTickToken = 0,
		currentTickController: AbortController | undefined,
		runPromise: Promise<void> | undefined,
		stopPromise: Promise<boolean> | undefined,
		resolveStopped: ((value: boolean) => void) | undefined,
		tickChain = Promise.resolve();
	const mailbox = new AsyncQueue<InternalMessage>({ capacity: queueCapacity }),
		events = new EventHub<PlotAgentEvent>(eventCapacity),
		runHandles = new Map<string, RunHandle>(),
		timers = new Set<AbortController>(),
		stallTimers = new Map<string, AbortController>(),
		// Last emitObservation per active run; drives stall detection.
		lastActivityAt = new Map<string, number>();
	const stoppingOrStopped = () =>
		lifecycle === "stopping" || lifecycle === "stopped";
	const publishSnapshot = (s: RuntimeState) => {
		snapshotCache = snapshotFrom(s);
	};
	const publishEvent = (event: PlotAgentEvent) => events.publish(event);
	// Control messages must never be dropped: a lost run_completed would leave
	// a run claimed forever. Only observations are subject to the queue bound.
	const offerControl = (message: InternalMessage) =>
		mailbox.offer(message, { force: true });
	const timer = (delayMs: number, message: InternalMessage) => {
		if (stoppingOrStopped()) return new AbortController();
		const c = new AbortController();
		timers.add(c);
		void sleep(delayMs, c.signal).then(() => {
			timers.delete(c);
			if (!c.signal.aborted && !stoppingOrStopped())
				return offerControl(message);
			return false;
		});
		return c;
	};
	const clearStallTimer = (run: WorkRun) => {
		const stallTimer = stallTimers.get(run.runId);
		if (stallTimer) stallTimer.abort();
		stallTimers.delete(run.runId);
	};
	const scheduleStallTimer = (run: WorkRun) => {
		if (stallTimeoutMs === undefined) return;
		clearStallTimer(run);
		stallTimers.set(run.runId, timer(stallTimeoutMs + 1, { type: "wake" }));
	};
	const interruptRunHandles = (runs: WorkRun[]) => {
		for (const run of runs) {
			const handle = runHandles.get(run.workKey);
			if (!handle || handle.run.runId !== run.runId) continue;
			runHandles.delete(run.workKey);
			handle.controller.abort();
		}
	};
	const abortTimers = () => {
		for (const c of timers) c.abort();
		timers.clear();
		for (const c of stallTimers.values()) c.abort();
		stallTimers.clear();
		activeTickToken = undefined;
	};
	const requestStop = () => {
		if (lifecycle === "stopped") return;
		lifecycle = "stopping";
		currentTickController?.abort();
		for (const handle of runHandles.values()) handle.controller.abort();
		abortTimers();
		mailbox.offer({ type: "wake" }, { force: true });
	};
	const completeRunningForShutdown = () => {
		const completedRuns = [...state.running.values()];
		if (completedRuns.length === 0) {
			state = { ...state, scheduledWakes: [] };
			publishSnapshot(state);
			return;
		}
		const completions = completedRuns.map((run): Completion => {
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "interrupted",
				error: "work run interrupted by plot agent shutdown",
			};
			if (run.subject !== undefined) completion.subject = run.subject;
			return completion;
		});
		const diagnostics = completions.flatMap((completion) => {
			const d = completionDiagnostic(completion);
			return d === undefined ? [] : [d];
		});
		const work = new Map(state.work);
		for (const completion of completions) {
			const record = work.get(completion.workKey);
			if (record?.currentRunId !== completion.runId) continue;
			const nextRecord: WorkRecord = {
				workKey: record.workKey,
				sourceId: record.sourceId,
				status: "failed",
			};
			if (record.subject !== undefined) nextRecord.subject = record.subject;
			if (record.display !== undefined) nextRecord.display = record.display;
			if (record.blockedReason !== undefined)
				nextRecord.blockedReason = record.blockedReason;
			if (record.operatorActions !== undefined)
				nextRecord.operatorActions = record.operatorActions;
			work.set(completion.workKey, nextRecord);
		}
		state = boundStateHistory(
			{
				...state,
				completions: [...state.completions, ...completions],
				diagnostics: [...state.diagnostics, ...diagnostics],
				work,
				running: new Map(),
				scheduledWakes: [],
			},
			historyLimit,
		);
		for (const completion of completions)
			publishEvent({ type: "attempt_completed", completion });
		interruptRunHandles(completedRuns);
		for (const run of completedRuns) {
			lastActivityAt.delete(run.runId);
			clearStallTimer(run);
		}
		publishSnapshot(state);
	};
	const finishStop = () => {
		if (lifecycle === "stopped") return;
		lifecycle = "stopping";
		currentTickController?.abort();
		for (const handle of runHandles.values()) handle.controller.abort();
		runHandles.clear();
		abortTimers();
		completeRunningForShutdown();
		mailbox.close();
		events.close();
		lifecycle = "stopped";
		resolveStopped?.(true);
	};
	const runHook = async <A>(
		phase: HookPhase,
		source: WorkSource,
		f: (() => Promise<A[]> | A[]) | undefined,
		fallback: A[],
		signal: AbortSignal,
	) => {
		if (!f || signal.aborted)
			return { items: fallback, diagnostics: [] as Diagnostic[] };
		const abort = waitForAbort(signal);
		try {
			const result = await Promise.race([
				Promise.resolve()
					.then(f)
					.then((items) => ({ type: "items" as const, items })),
				abort.promise.then(() => ({ type: "aborted" as const })),
			]);
			if (result.type === "aborted")
				return { items: fallback, diagnostics: [] as Diagnostic[] };
			return { items: result.items, diagnostics: [] as Diagnostic[] };
		} catch (error) {
			if (signal.aborted)
				return { items: fallback, diagnostics: [] as Diagnostic[] };
			await logWideEvent(
				{
					operation: `plot_agent.source.${phase}`,
					outcome: "error",
					error: errorMessage(error),
					source_id: source.id,
					tick_id: state.tickId,
				},
				"error",
			);
			return {
				items: fallback,
				diagnostics: [hookDiagnostic(phase, source.id, error)],
			};
		} finally {
			abort.cleanup();
		}
	};
	const executeWorkRun = async (
		selection: WorkSelection,
		run: WorkRun,
		runSnapshot: RuntimeSnapshot,
		signal: AbortSignal,
	) => {
		const startedAt = Date.now();
		const emitObservation = async (observation: Observation) => {
			if (signal.aborted || stoppingOrStopped()) return false;
			lastActivityAt.set(run.runId, Date.now());
			scheduleStallTimer(run);
			return mailbox.offer({
				type: "observation",
				observation:
					observation.subject === undefined && run.subject !== undefined
						? { ...observation, subject: run.subject }
						: observation,
			});
		};
		const shouldContinue = selection.source.continueWork
			? (turnNumber: number) =>
					selection.source.continueWork!({
						sourceId: selection.source.id,
						tickId: runSnapshot.tickId,
						snapshot: snapshotFrom(state),
						signal,
						run,
						work: selection.work,
						turnNumber,
					})
			: undefined;
		try {
			const context: WorkRunnerContext = {
				sourceId: selection.source.id,
				tickId: runSnapshot.tickId,
				run,
				work: selection.work,
				snapshot: runSnapshot,
				signal,
				emitObservation,
			};
			if (shouldContinue !== undefined) context.shouldContinue = shouldContinue;
			const result = await runner.run(context);
			if (signal.aborted) throw new Error("work run interrupted");
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "succeeded",
			};
			if (run.subject !== undefined) completion.subject = run.subject;
			if (result.output !== undefined) completion.output = result.output;
			await logWideEvent({
				operation: "plot_agent.work.run",
				outcome: "success",
				status: "succeeded",
				source_id: selection.source.id,
				run_id: run.runId,
				work_key: run.workKey,
				tick_id: runSnapshot.tickId,
				duration_ms: Date.now() - startedAt,
			});
			offerControl({ type: "run_completed", run, completion });
		} catch (error) {
			const interrupted = signal.aborted;
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: interrupted ? "interrupted" : "failed",
				error: interrupted ? "work run interrupted" : errorMessage(error),
			};
			if (run.subject !== undefined) completion.subject = run.subject;
			await logWideEvent(
				{
					operation: "plot_agent.work.run",
					outcome: "error",
					status: completion.status,
					error: completion.error,
					source_id: selection.source.id,
					run_id: run.runId,
					work_key: run.workKey,
					tick_id: runSnapshot.tickId,
					duration_ms: Date.now() - startedAt,
				},
				"error",
			);
			offerControl({ type: "run_completed", run, completion });
		}
	};
	const runTickUnsafe = async (initialMessages: InternalMessage[] = []) =>
		withWideEvent("plot_agent.tick", {}, async () => {
			const controller = new AbortController();
			currentTickController = controller;
			const signal = controller.signal;
			const aborted = () => signal.aborted || stoppingOrStopped();
			const noDispatchResult = (
				tickId: number,
				input: {
					observations?: Observation[];
					proposals?: ReconcileProposal[];
					completions?: Completion[];
					diagnostics?: Diagnostic[];
				} = {},
			): TickResult => ({
				tickId,
				observations: input.observations ?? [],
				proposals: input.proposals ?? [],
				selected: [],
				started: [],
				skipped: [],
				completions: input.completions ?? [],
				diagnostics: input.diagnostics ?? [],
				snapshot: snapshotFrom(state),
			});
			try {
				const drained = drainMessages([...initialMessages, ...mailbox.drain()]);
				if (drained.shutdownRequested) requestStop();
				if (aborted()) {
					publishSnapshot(state);
					return {
						shutdownRequested: true,
						result: noDispatchResult(state.tickId),
					};
				}
				const now = Date.now();
				const stalledRuns: TimedOutRun[] =
					stallTimeoutMs === undefined
						? []
						: [...state.running.values()]
								.filter(
									(run) =>
										now - (lastActivityAt.get(run.runId) ?? now) >
										stallTimeoutMs,
								)
								.map((run) => ({
									run,
									error: `work run stalled; no activity for ${stallTimeoutMs}ms`,
								}));
				const began = beginTick(state, drained, stalledRuns, historyLimit);
				state = began.state;
				const tickId = state.tickId;
				publishEvent({ type: "tick_started", tickId });
				for (const completion of began.completions)
					publishEvent({ type: "attempt_completed", completion });
				interruptRunHandles(began.completedRuns);
				for (const run of began.completedRuns) {
					lastActivityAt.delete(run.runId);
					clearStallTimer(run);
				}
				const observeResults = await Promise.all(
					sources.map((source) =>
						runHook(
							"observe",
							source,
							source.observeTick
								? () =>
										source.observeTick!({
											sourceId: source.id,
											tickId,
											snapshot: snapshotFrom(state),
											signal,
										})
								: undefined,
							[] as Observation[],
							signal,
						),
					),
				);
				const observations = observeResults.flatMap(
						(r) => r.items as Observation[],
					),
					observeDiagnostics = observeResults.flatMap((r) => r.diagnostics);
				if (aborted()) {
					publishSnapshot(state);
					return {
						shutdownRequested: true,
						result: noDispatchResult(tickId, {
							observations,
							diagnostics: [...began.diagnostics, ...observeDiagnostics],
							completions: began.completions,
						}),
					};
				}
				state = applyObserved(
					state,
					observations,
					observeDiagnostics,
					historyLimit,
				);
				const reconcileResults = await Promise.all(
					sources.map((source) =>
						runHook(
							"reconcile",
							source,
							source.reconcile
								? () =>
										source.reconcile!({
											sourceId: source.id,
											tickId,
											snapshot: snapshotFrom(state),
											signal,
										})
								: undefined,
							[] as ReconcileProposal[],
							signal,
						),
					),
				);
				const proposals = reconcileResults.flatMap(
						(r) => r.items as ReconcileProposal[],
					),
					reconcileDiagnostics = reconcileResults.flatMap((r) => r.diagnostics);
				if (aborted()) {
					publishSnapshot(state);
					return {
						shutdownRequested: true,
						result: noDispatchResult(tickId, {
							observations,
							proposals,
							diagnostics: [
								...began.diagnostics,
								...observeDiagnostics,
								...reconcileDiagnostics,
							],
							completions: began.completions,
						}),
					};
				}
				state = applyReconciled(
					state,
					proposals,
					reconcileDiagnostics,
					historyLimit,
				);
				for (const proposal of proposals) {
					if (proposal.type === "upsert_work") {
						const work = state.work.get(proposal.work.workKey);
						if (work !== undefined)
							publishEvent({ type: "work_observed", work });
					} else if (
						proposal.type === "remove_work" &&
						!state.work.has(proposal.workKey)
					) {
						publishEvent({ type: "work_removed", workKey: proposal.workKey });
					}
				}
				const wakeProposals = proposals.filter(
					(p): p is ScheduleWakeProposal => p.type === "schedule_wake",
				);
				for (const proposal of wakeProposals) {
					publishEvent(wakeScheduledEvent(proposal));
					timer(proposal.delayMs, { type: "wake" });
				}
				const interrupted = interruptRunningWork(
					state,
					proposals.filter(
						(p): p is InterruptWorkProposal => p.type === "interrupt_work",
					),
					historyLimit,
				);
				state = interrupted.state;
				for (const completion of interrupted.completions)
					publishEvent({ type: "attempt_completed", completion });
				interruptRunHandles(interrupted.interruptedRuns);
				for (const run of interrupted.interruptedRuns) {
					lastActivityAt.delete(run.runId);
					clearStallTimer(run);
				}
				const policyDiagnostics: Diagnostic[] = policy.validate
					? await Promise.resolve(policy.validate(snapshotFrom(state))).catch(
							(error: unknown) => [
								{
									level: "error" as const,
									phase: "policy" as const,
									message: errorMessage(error),
								},
							],
						)
					: [];
				if (policyDiagnostics.length)
					state = applyDiagnostics(state, policyDiagnostics, historyLimit);
				const policyFailed = policyDiagnostics.some((d) => d.level === "error");
				if (policyFailed || dispatchPaused || aborted()) {
					publishSnapshot(state);
					const result = noDispatchResult(tickId, {
						observations,
						proposals,
						completions: [...began.completions, ...interrupted.completions],
						diagnostics: [
							...began.diagnostics,
							...observeDiagnostics,
							...reconcileDiagnostics,
							...interrupted.diagnostics,
							...policyDiagnostics,
						],
					});
					if (!aborted()) publishEvent({ type: "tick_completed", result });
					return { shutdownRequested: aborted(), result };
				}
				const selectResults = await Promise.all(
					sources.map((source) =>
						runHook(
							"select",
							source,
							source.selectWork
								? () =>
										source.selectWork!({
											sourceId: source.id,
											tickId,
											snapshot: snapshotFrom(state),
											signal,
										})
								: undefined,
							[] as WorkItem[],
							signal,
						),
					),
				);
				const selectedWithSources = selectResults.flatMap((r, i) =>
					(r.items as WorkItem[]).map((work) => ({
						source: sources[i]!,
						work,
					})),
				);
				const selectDiagnostics = selectResults.flatMap((r) => r.diagnostics);
				if (selectDiagnostics.length)
					state = applyDiagnostics(state, selectDiagnostics, historyLimit);
				if (aborted()) {
					publishSnapshot(state);
					return {
						shutdownRequested: true,
						result: noDispatchResult(tickId, {
							observations,
							proposals,
							completions: [...began.completions, ...interrupted.completions],
							diagnostics: [
								...began.diagnostics,
								...observeDiagnostics,
								...reconcileDiagnostics,
								...interrupted.diagnostics,
								...policyDiagnostics,
								...selectDiagnostics,
							],
						}),
					};
				}
				const startedResult = startEligibleRuns(
					state,
					selectedWithSources,
					policy.maxConcurrentRuns ?? 100,
					interrupted.interruptedKeys,
				);
				state = startedResult.state;
				const runSnapshot = snapshotFrom(state);
				for (const { run, selection } of startedResult.started) {
					publishEvent({ type: "attempt_started", run });
					lastActivityAt.set(run.runId, Date.now());
					scheduleStallTimer(run);
					const runController = new AbortController();
					runHandles.set(run.workKey, { run, controller: runController });
					void executeWorkRun(
						selection,
						run,
						runSnapshot,
						runController.signal,
					);
					if (maxRunDurationMs !== undefined)
						timer(maxRunDurationMs, { type: "run_timeout", run });
				}
				publishSnapshot(state);
				const result: TickResult = {
					tickId,
					observations,
					proposals,
					selected: selectedWithSources.map((s) => s.work),
					started: startedResult.started.map((s) => s.run),
					skipped: startedResult.skipped,
					completions: [...began.completions, ...interrupted.completions],
					diagnostics: [
						...began.diagnostics,
						...observeDiagnostics,
						...reconcileDiagnostics,
						...interrupted.diagnostics,
						...policyDiagnostics,
						...selectDiagnostics,
					],
					snapshot: snapshotFrom(state),
				};
				publishEvent({ type: "tick_completed", result });
				return { shutdownRequested: false, result };
			} finally {
				if (currentTickController === controller)
					currentTickController = undefined;
			}
		});
	const runTick = (messages: InternalMessage[] = []) => {
		const next = tickChain.then(() => runTickUnsafe(messages));
		tickChain = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};
	const waitForStop = () => {
		if (lifecycle === "stopped") return Promise.resolve(true);
		if (stopPromise === undefined)
			stopPromise = new Promise<boolean>((resolve) => {
				resolveStopped = resolve;
			});
		return stopPromise;
	};
	const runLoop = async () =>
		withWideEvent(
			"plot_agent.run",
			{ source_count: sources.length },
			async () => {
				try {
					while (!stoppingOrStopped()) {
						let message: InternalMessage;
						try {
							// eslint-disable-next-line no-await-in-loop -- actor loop processes one mailbox message at a time.
							message = await mailbox.take();
						} catch {
							break;
						}
						if (message.type === "shutdown") {
							requestStop();
							break;
						}
						if (message.type === "scheduled_tick") {
							if (activeTickToken !== message.token) continue;
							activeTickToken = undefined;
						}
						// eslint-disable-next-line no-await-in-loop -- reconciliation must finish before the next actor message.
						const tick = await runTick([message]);
						if (tick.shutdownRequested || stoppingOrStopped()) break;
						const token = ++nextTickToken;
						activeTickToken = token;
						timer(tickIntervalMs, { type: "scheduled_tick", token });
					}
				} finally {
					finishStop();
				}
			},
		);
	const api: PlotAgent = {
		start: async () => {
			if (lifecycle === "stopped" || lifecycle === "stopping") return;
			void api.run();
			offerControl({ type: "wake" });
		},
		run: async () => {
			if (runPromise !== undefined) return runPromise;
			if (lifecycle === "stopped") return;
			if (lifecycle === "stopping") {
				await waitForStop();
				return;
			}
			lifecycle = "running";
			runPromise = runLoop().finally(() => {
				runPromise = undefined;
			});
			return runPromise;
		},
		tickOnce: async () => (await runTick()).result,
		snapshot: async () => snapshotCache,
		events: () => events.subscribe(),
		offer: async (message) => {
			if (message.type === "shutdown") {
				if (lifecycle !== "stopped") requestStop();
				return true;
			}
			if (stoppingOrStopped()) return false;
			return message.type === "observation"
				? mailbox.offer(message)
				: offerControl(message);
		},
		interruptAgentRun: async (input) => {
			if (stoppingOrStopped()) return false;
			const message: InternalMessage = {
				type: "interrupt_run",
				runId: input.runId,
			};
			if (input.workKey !== undefined) message.workKey = input.workKey;
			if (lifecycle === "running") return offerControl(message);
			await runTick([message]);
			return true;
		},
		pauseDispatch: async () => {
			dispatchPaused = true;
		},
		resumeDispatch: async () => {
			dispatchPaused = false;
		},
		wakeAfter: async (delayMs, reason) => {
			if (stoppingOrStopped()) return;
			const safeDelay = positive(
				delayMs,
				1,
				"delayMs must be a positive integer",
			);
			const wake: Domain.ScheduledWake = {
				dueAtMs: Date.now() + safeDelay,
				delayMs: safeDelay,
			};
			if (reason !== undefined) wake.reason = reason;
			// State is only mutated inside the tick chain; record the wake via
			// the mailbox so a mid-flight tick cannot overwrite it.
			offerControl({ type: "wake_requested", wake });
			const event: PlotAgentEvent = {
				type: "wake_scheduled",
				delayMs: safeDelay,
			};
			if (reason !== undefined) event.reason = reason;
			publishEvent(event);
			timer(safeDelay, { type: "wake" });
		},
		shutdown: async () => {
			if (lifecycle === "stopped") return true;
			const stopped = waitForStop();
			requestStop();
			if (runPromise === undefined) finishStop();
			await stopped;
			return true;
		},
	};
	return api;
};
