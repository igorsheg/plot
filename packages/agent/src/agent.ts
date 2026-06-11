import { AsyncQueue } from "@plot/common/async-queue";
import { EventHub } from "@plot/common/event-stream";
import { logWideEvent, withWideEvent } from "@plot/common/observability";
import * as Domain from "./model.js";
import type {
	Completion,
	Diagnostic,
	HookPhase,
	InterruptWorkProposal,
	Observation,
	PlotAgentEvent,
	PlotAgentMessage,
	ReconcileProposal,
	RuntimeSnapshot,
	ScheduleWakeProposal,
	SourceId,
	SubjectKey,
	TickResult,
	WorkItem,
	WorkKey,
	WorkResult,
	WorkRun,
} from "./model.js";
import type { WorkRunner } from "./work-runner.js";
import type { AgentPolicy, WorkSource } from "./work-source.js";

interface RuntimeState {
	readonly tickId: Domain.TickId;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly running: ReadonlyMap<WorkKey, WorkRun>;
	readonly scheduledWakes: readonly Domain.ScheduledWake[];
	readonly nextRunIndex: number;
}
type InternalMessage =
	| PlotAgentMessage
	| {
			readonly type: "run_completed";
			readonly run: WorkRun;
			readonly completion: Completion;
	  }
	| { readonly type: "scheduled_tick"; readonly token: number }
	| { readonly type: "wake" }
	| { readonly type: "run_timeout"; readonly run: WorkRun };
interface DrainedMessages {
	readonly observations: readonly Observation[];
	readonly completions: readonly {
		readonly run: WorkRun;
		readonly completion: Completion;
	}[];
	readonly timedOutRuns: readonly WorkRun[];
	readonly shutdownRequested: boolean;
}
interface WorkSelection {
	readonly source: WorkSource;
	readonly work: WorkItem;
}
interface RunHandle {
	readonly run: WorkRun;
	readonly controller: AbortController;
}

export interface PlotAgentShape {
	readonly start: () => Promise<void>;
	readonly run: () => Promise<void>;
	readonly tickOnce: () => Promise<TickResult>;
	readonly snapshot: () => Promise<RuntimeSnapshot>;
	readonly events: () => AsyncIterable<PlotAgentEvent>;
	readonly offer: (message: PlotAgentMessage) => Promise<boolean>;
	readonly wakeAfter: (delayMs: number, reason?: string) => Promise<void>;
	readonly shutdown: () => Promise<boolean>;
}
export type PlotAgent = PlotAgentShape;
export const PlotAgent = Symbol("PlotAgent");
export interface PlotAgentLayerOptions {
	readonly sources: readonly WorkSource[];
	readonly runner: WorkRunner;
	readonly policy?: AgentPolicy;
	readonly queueCapacity?: number;
	readonly eventCapacity?: number;
	readonly historyLimit?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
}

const initialState: RuntimeState = {
	tickId: 0,
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	running: new Map(),
	scheduledWakes: [],
	nextRunIndex: 0,
};
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };
const optionalOutput = (output: unknown) =>
	output === undefined ? {} : { output };
const takeRight = <A>(items: readonly A[], limit: number) =>
	items.length <= limit ? [...items] : items.slice(items.length - limit);
const boundStateHistory = (
	state: RuntimeState,
	limit: number,
): RuntimeState => ({
	...state,
	observations: takeRight(state.observations, limit),
	completions: takeRight(state.completions, limit),
	diagnostics: takeRight(state.diagnostics, limit),
});
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
const completionDiagnostic = (completion: Completion): Diagnostic | undefined =>
	completion.status === "succeeded"
		? undefined
		: {
				level: completion.status === "failed" ? "error" : "warning",
				phase: "act",
				sourceId: completion.sourceId,
				runId: completion.runId,
				workKey: completion.workKey,
				message: completion.error ?? `work run ${completion.status}`,
			};
const snapshotFrom = (state: RuntimeState): RuntimeSnapshot => ({
	tickId: state.tickId,
	facts: new Map(state.facts),
	observations: [...state.observations],
	completions: [...state.completions],
	diagnostics: [...state.diagnostics],
	running: new Map(state.running),
	scheduledWakes: state.scheduledWakes.filter(
		(wake) => wake.dueAtMs > Date.now(),
	),
});
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

const drainMessages = (
	messages: readonly InternalMessage[],
): DrainedMessages => {
	const observations: Observation[] = [],
		completions: { run: WorkRun; completion: Completion }[] = [],
		timedOutRuns: WorkRun[] = [];
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") observations.push(message.observation);
		else if (message.type === "run_completed")
			completions.push({ run: message.run, completion: message.completion });
		else if (message.type === "run_timeout") timedOutRuns.push(message.run);
		else if (message.type === "shutdown") shutdownRequested = true;
	}
	return { observations, completions, timedOutRuns, shutdownRequested };
};
const applyFactProposals = (
	facts: ReadonlyMap<string, unknown>,
	proposals: readonly ReconcileProposal[],
) => {
	const next = new Map(facts);
	for (const proposal of proposals) {
		if (proposal.type === "set_fact") next.set(proposal.key, proposal.value);
		else if (proposal.type === "remove_fact") next.delete(proposal.key);
	}
	return next;
};
const beginTick = (
	state: RuntimeState,
	drained: DrainedMessages,
	historyLimit: number,
) => {
	const running = new Map(state.running),
		completions: Completion[] = [],
		diagnostics: Diagnostic[] = [],
		completedRuns: WorkRun[] = [];
	for (const item of drained.completions) {
		const active = running.get(item.run.workKey);
		if (!active || active.runId !== item.run.runId) continue;
		running.delete(item.run.workKey);
		completions.push(item.completion);
		completedRuns.push(item.run);
		const d = completionDiagnostic(item.completion);
		if (d) diagnostics.push(d);
	}
	for (const timedOutRun of drained.timedOutRuns) {
		const active = running.get(timedOutRun.workKey);
		if (!active || active.runId !== timedOutRun.runId) continue;
		running.delete(timedOutRun.workKey);
		completedRuns.push(timedOutRun);
		const completion: Completion = {
			runId: timedOutRun.runId,
			sourceId: timedOutRun.sourceId,
			workKey: timedOutRun.workKey,
			status: "timed_out",
			...optionalSubject(timedOutRun.subject),
			error: "work run timed out",
		};
		completions.push(completion);
		const d = completionDiagnostic(completion);
		if (d) diagnostics.push(d);
	}
	if (drained.shutdownRequested)
		for (const run of running.values()) {
			running.delete(run.workKey);
			completedRuns.push(run);
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "interrupted",
				...optionalSubject(run.subject),
				error: "work run interrupted by plot agent shutdown",
			};
			completions.push(completion);
			const d = completionDiagnostic(completion);
			if (d) diagnostics.push(d);
		}
	const next = boundStateHistory(
		{
			...state,
			tickId: state.tickId + 1,
			observations: [...state.observations, ...drained.observations],
			completions: [...state.completions, ...completions],
			diagnostics: [...state.diagnostics, ...diagnostics],
			running,
		},
		historyLimit,
	);
	return { state: next, completions, diagnostics, completedRuns };
};
const applyObserved = (
	state: RuntimeState,
	observations: readonly Observation[],
	diagnostics: readonly Diagnostic[],
	historyLimit: number,
): RuntimeState =>
	boundStateHistory(
		{
			...state,
			observations: [...state.observations, ...observations],
			diagnostics: [...state.diagnostics, ...diagnostics],
		},
		historyLimit,
	);
const wakeFromProposal = (proposal: ScheduleWakeProposal, now: number) => ({
	dueAtMs: now + proposal.delayMs,
	delayMs: proposal.delayMs,
	...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
	...(proposal.workKey === undefined ? {} : { workKey: proposal.workKey }),
	...(proposal.attempt === undefined ? {} : { attempt: proposal.attempt }),
});

const wakeScheduledEvent = (proposal: ScheduleWakeProposal) => ({
	type: "wake_scheduled" as const,
	delayMs: proposal.delayMs,
	...(proposal.reason === undefined ? {} : { reason: proposal.reason }),
	...(proposal.workKey === undefined ? {} : { workKey: proposal.workKey }),
	...(proposal.attempt === undefined ? {} : { attempt: proposal.attempt }),
});

const applyReconciled = (
	state: RuntimeState,
	proposals: readonly ReconcileProposal[],
	diagnostics: readonly Diagnostic[],
	historyLimit: number,
): RuntimeState => {
	const now = Date.now();
	const scheduledWakes = [
		...state.scheduledWakes.filter((wake) => wake.dueAtMs > now),
		...proposals
			.filter((p): p is ScheduleWakeProposal => p.type === "schedule_wake")
			.map((proposal) => wakeFromProposal(proposal, now)),
	].toSorted((a, b) => a.dueAtMs - b.dueAtMs);
	return boundStateHistory(
		{
			...state,
			facts: applyFactProposals(state.facts, proposals),
			observations: [],
			completions: [],
			diagnostics: [...state.diagnostics, ...diagnostics],
			scheduledWakes,
		},
		historyLimit,
	);
};
const applyDiagnostics = (
	state: RuntimeState,
	diagnostics: readonly Diagnostic[],
	historyLimit: number,
): RuntimeState =>
	boundStateHistory(
		{ ...state, diagnostics: [...state.diagnostics, ...diagnostics] },
		historyLimit,
	);
const interruptRunningWork = (
	state: RuntimeState,
	proposals: readonly InterruptWorkProposal[],
	historyLimit: number,
) => {
	const running = new Map(state.running),
		completions: Completion[] = [],
		diagnostics: Diagnostic[] = [],
		interruptedRuns: WorkRun[] = [],
		interruptedKeys = new Set<WorkKey>();
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
		const d = completionDiagnostic(completion);
		if (d) diagnostics.push(d);
	}
	return {
		state: boundStateHistory(
			{
				...state,
				completions: [...state.completions, ...completions],
				diagnostics: [...state.diagnostics, ...diagnostics],
				running,
			},
			historyLimit,
		),
		completions,
		diagnostics,
		interruptedRuns,
		interruptedKeys,
	};
};
const runningCountBySource = (running: ReadonlyMap<WorkKey, WorkRun>) => {
	const counts = new Map<SourceId, number>();
	for (const run of running.values())
		counts.set(run.sourceId, (counts.get(run.sourceId) ?? 0) + 1);
	return counts;
};
const startEligibleRuns = (
	state: RuntimeState,
	selected: readonly WorkSelection[],
	maxConcurrentRuns: number,
	blockedThisTick: ReadonlySet<WorkKey> = new Set(),
) => {
	const running = new Map(state.running),
		runningBySource = runningCountBySource(running),
		started: { run: WorkRun; selection: WorkSelection }[] = [],
		seen = new Set<WorkKey>();
	let nextRunIndex = state.nextRunIndex;
	const capacity = Math.max(0, maxConcurrentRuns - running.size);
	for (const selection of selected.toSorted((a, b) =>
		String(a.work.workKey).localeCompare(String(b.work.workKey)),
	)) {
		if (started.length >= capacity) break;
		const { work } = selection;
		if (
			seen.has(work.workKey) ||
			blockedThisTick.has(work.workKey) ||
			running.has(work.workKey)
		)
			continue;
		seen.add(work.workKey);
		const maxRuns = selection.source.policy?.maxConcurrentRuns;
		if (
			maxRuns !== undefined &&
			(runningBySource.get(selection.source.id) ?? 0) >= maxRuns
		)
			continue;
		const run: WorkRun = {
			runId: `run-${nextRunIndex}`,
			sourceId: selection.source.id,
			workKey: work.workKey,
			...optionalSubject(work.subject),
			...(work.display === undefined ? {} : { display: work.display }),
		};
		nextRunIndex++;
		running.set(work.workKey, run);
		runningBySource.set(
			selection.source.id,
			(runningBySource.get(selection.source.id) ?? 0) + 1,
		);
		started.push({ run, selection });
	}
	return { state: { ...state, running, nextRunIndex }, started };
};

export const makePlotAgentLayer = (
	options: PlotAgentLayerOptions,
): PlotAgentShape => {
	const sources = options.sources,
		runner = options.runner,
		policy = options.policy ?? {};
	const seen = new Set<SourceId>();
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
	const tickIntervalMs =
		options.tickIntervalMs === undefined
			? undefined
			: positive(
					options.tickIntervalMs,
					1,
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
	let state = initialState,
		snapshotCache = snapshotFrom(initialState),
		actorStarted = false,
		activeTickToken: number | undefined,
		nextTickToken = 0,
		tickChain = Promise.resolve();
	const mailbox = new AsyncQueue<InternalMessage>({ capacity: queueCapacity }),
		events = new EventHub<PlotAgentEvent>(eventCapacity),
		runHandles = new Map<WorkKey, RunHandle>(),
		timers = new Set<AbortController>();
	const publishSnapshot = (s: RuntimeState) => {
		snapshotCache = snapshotFrom(s);
	};
	const publishEvent = (event: PlotAgentEvent) => events.publish(event);
	const timer = (delayMs: number, message: InternalMessage) => {
		const c = new AbortController();
		timers.add(c);
		void sleep(delayMs, c.signal).then(() => {
			timers.delete(c);
			if (!c.signal.aborted) return mailbox.offer(message);
			return false;
		});
		return c;
	};
	const interruptRunHandles = (runs: readonly WorkRun[]) => {
		for (const run of runs) {
			const handle = runHandles.get(run.workKey);
			if (!handle || handle.run.runId !== run.runId) continue;
			runHandles.delete(run.workKey);
			handle.controller.abort();
		}
	};
	const runHook = async <A>(
		phase: HookPhase,
		source: WorkSource,
		f: (() => Promise<readonly A[]> | readonly A[]) | undefined,
		fallback: readonly A[],
	) => {
		if (!f) return { items: fallback, diagnostics: [] as Diagnostic[] };
		try {
			return { items: await f(), diagnostics: [] as Diagnostic[] };
		} catch (error) {
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
		}
	};
	const executeWorkRun = async (
		selection: WorkSelection,
		run: WorkRun,
		runSnapshot: RuntimeSnapshot,
		signal: AbortSignal,
	) => {
		const startedAt = Date.now();
		const emitObservation = async (observation: Observation) =>
			mailbox.offer({
				type: "observation",
				observation:
					observation.subject === undefined && run.subject !== undefined
						? { ...observation, subject: run.subject }
						: observation,
			});
		try {
			const result = await runner.run({
				sourceId: selection.source.id,
				tickId: runSnapshot.tickId,
				run,
				work: selection.work,
				snapshot: runSnapshot,
				signal,
				emitObservation,
			});
			if (signal.aborted) throw new Error("work run interrupted");
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "succeeded",
				...optionalSubject(run.subject),
				...optionalOutput((result as WorkResult).output),
			};
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
			mailbox.offer({ type: "run_completed", run, completion });
		} catch (error) {
			const interrupted = signal.aborted;
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: interrupted ? "interrupted" : "failed",
				...optionalSubject(run.subject),
				error: interrupted ? "work run interrupted" : errorMessage(error),
			};
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
			mailbox.offer({ type: "run_completed", run, completion });
		}
	};
	const runTickUnsafe = async (
		initialMessages: readonly InternalMessage[] = [],
	) =>
		withWideEvent("plot_agent.tick", {}, async () => {
			const drained = drainMessages([...initialMessages, ...mailbox.drain()]);
			const began = beginTick(state, drained, historyLimit);
			state = began.state;
			const tickId = state.tickId;
			publishEvent({ type: "tick_started", tickId });
			for (const completion of began.completions)
				publishEvent({ type: "work_completed", completion });
			interruptRunHandles(began.completedRuns);
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
									})
							: undefined,
						[] as Observation[],
					),
				),
			);
			const observations = observeResults.flatMap(
					(r) => r.items as Observation[],
				),
				observeDiagnostics = observeResults.flatMap((r) => r.diagnostics);
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
									})
							: undefined,
						[] as ReconcileProposal[],
					),
				),
			);
			const proposals = reconcileResults.flatMap(
					(r) => r.items as ReconcileProposal[],
				),
				reconcileDiagnostics = reconcileResults.flatMap((r) => r.diagnostics);
			state = applyReconciled(
				state,
				proposals,
				reconcileDiagnostics,
				historyLimit,
			);
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
				publishEvent({ type: "work_completed", completion });
			interruptRunHandles(interrupted.interruptedRuns);
			const policyDiagnostics: readonly Diagnostic[] = policy.validate
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
			if (policyFailed || drained.shutdownRequested) {
				publishSnapshot(state);
				const result: TickResult = {
					tickId,
					observations,
					proposals,
					selected: [],
					started: [],
					completions: [...began.completions, ...interrupted.completions],
					diagnostics: [
						...began.diagnostics,
						...observeDiagnostics,
						...reconcileDiagnostics,
						...interrupted.diagnostics,
						...policyDiagnostics,
					],
					snapshot: snapshotFrom(state),
				};
				publishEvent({ type: "tick_completed", result });
				return { shutdownRequested: drained.shutdownRequested, result };
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
									})
							: undefined,
						[] as WorkItem[],
					),
				),
			);
			const selectedWithSources = selectResults.flatMap((r, i) =>
				(r.items as WorkItem[]).map((work) => ({ source: sources[i]!, work })),
			);
			const selectDiagnostics = selectResults.flatMap((r) => r.diagnostics);
			if (selectDiagnostics.length)
				state = applyDiagnostics(state, selectDiagnostics, historyLimit);
			const startedResult = startEligibleRuns(
				state,
				selectedWithSources,
				policy.maxConcurrentRuns ?? 100,
				interrupted.interruptedKeys,
			);
			state = startedResult.state;
			const runSnapshot = snapshotFrom(state);
			for (const { run, selection } of startedResult.started) {
				publishEvent({ type: "work_started", run });
				const controller = new AbortController();
				runHandles.set(run.workKey, { run, controller });
				void executeWorkRun(selection, run, runSnapshot, controller.signal);
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
		});
	const runTick = (messages: readonly InternalMessage[] = []) => {
		const next = tickChain.then(() => runTickUnsafe(messages));
		tickChain = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	};
	const api: PlotAgentShape = {
		start: async () => {
			if (actorStarted) return;
			actorStarted = true;
			mailbox.offer({ type: "wake" });
			void api.run().finally(() => {
				actorStarted = false;
			});
		},
		run: async () =>
			withWideEvent(
				"plot_agent.run",
				{ source_count: sources.length },
				async () => {
					let running = true;
					while (running) {
						const message = await mailbox.take();
						if (message.type === "scheduled_tick") {
							if (activeTickToken !== message.token) continue;
							activeTickToken = undefined;
						}
						const tick = await runTick([message]);
						running = !tick.shutdownRequested;
						if (running && tickIntervalMs !== undefined) {
							const token = ++nextTickToken;
							activeTickToken = token;
							timer(tickIntervalMs, { type: "scheduled_tick", token });
						}
					}
					for (const handle of runHandles.values()) handle.controller.abort();
					for (const c of timers) c.abort();
				},
			),
		tickOnce: async () => (await runTick()).result,
		snapshot: async () => snapshotCache,
		events: () => events.subscribe(),
		offer: async (message) => mailbox.offer(message),
		wakeAfter: async (delayMs, reason) => {
			const safeDelay = positive(
				delayMs,
				1,
				"delayMs must be a positive integer",
			);
			const now = Date.now();
			state = {
				...state,
				scheduledWakes: [
					...state.scheduledWakes.filter((wake) => wake.dueAtMs > now),
					{
						dueAtMs: now + safeDelay,
						delayMs: safeDelay,
						...(reason === undefined ? {} : { reason }),
					},
				].toSorted((a, b) => a.dueAtMs - b.dueAtMs),
			};
			publishSnapshot(state);
			publishEvent({
				type: "wake_scheduled",
				delayMs: safeDelay,
				...(reason === undefined ? {} : { reason }),
			});
			timer(safeDelay, { type: "wake" });
		},
		shutdown: async () => mailbox.offer({ type: "shutdown" }),
	};
	return api;
};
