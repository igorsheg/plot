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
	SkippedWork,
	SourceId,
	WorkRecord,
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
	readonly work: ReadonlyMap<WorkKey, WorkRecord>;
	readonly running: ReadonlyMap<WorkKey, WorkRun>;
	readonly scheduledWakes: readonly Domain.ScheduledWake[];
	readonly nextRunIndex: number;
}
interface TimedOutRun {
	readonly run: WorkRun;
	readonly error: string;
}
type AgentLifecycle = "new" | "running" | "stopping" | "stopped";

type InternalMessage =
	| PlotAgentMessage
	| {
			readonly type: "run_completed";
			readonly run: WorkRun;
			readonly completion: Completion;
	  }
	| { readonly type: "scheduled_tick"; readonly token: number }
	| { readonly type: "wake" }
	| { readonly type: "wake_requested"; readonly wake: Domain.ScheduledWake }
	| { readonly type: "run_timeout"; readonly run: WorkRun }
	| {
			readonly type: "interrupt_run";
			readonly runId: Domain.RunId;
			readonly workKey?: WorkKey;
	  };
interface DrainedMessages {
	readonly observations: readonly Observation[];
	readonly completions: readonly {
		readonly run: WorkRun;
		readonly completion: Completion;
	}[];
	readonly timedOutRuns: readonly WorkRun[];
	readonly interruptions: readonly {
		readonly runId: Domain.RunId;
		readonly workKey?: WorkKey;
	}[];
	readonly requestedWakes: readonly Domain.ScheduledWake[];
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
	readonly interruptAgentRun: (input: {
		readonly runId: Domain.RunId;
		readonly workKey?: WorkKey;
	}) => Promise<boolean>;
	readonly pauseDispatch: () => Promise<void>;
	readonly resumeDispatch: () => Promise<void>;
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
	/** Scheduler poll cadence. Default: 30s. */
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	/** Interrupt a run after this much time with no emitted observations. */
	readonly stallTimeoutMs?: number;
}

const initialState: RuntimeState = {
	tickId: 0,
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	work: new Map(),
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
	work: new Map(state.work),
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
		timedOutRuns: WorkRun[] = [],
		interruptions: { runId: Domain.RunId; workKey?: WorkKey }[] = [],
		requestedWakes: Domain.ScheduledWake[] = [];
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") observations.push(message.observation);
		else if (message.type === "run_completed")
			completions.push({ run: message.run, completion: message.completion });
		else if (message.type === "run_timeout") timedOutRuns.push(message.run);
		else if (message.type === "interrupt_run")
			interruptions.push({
				runId: message.runId,
				...(message.workKey === undefined ? {} : { workKey: message.workKey }),
			});
		else if (message.type === "wake_requested")
			requestedWakes.push(message.wake);
		else if (message.type === "shutdown") shutdownRequested = true;
	}
	return {
		observations,
		completions,
		timedOutRuns,
		interruptions,
		requestedWakes,
		shutdownRequested,
	};
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

// Reconciliation can update display metadata, but active Agent Runs stay
// Plot-owned until completion, timeout, shutdown, or an interrupt_work proposal.
const activeWorkRecord = (
	run: WorkRun,
	record: WorkRecord | undefined,
): WorkRecord => ({
	workKey: run.workKey,
	sourceId: run.sourceId,
	status: record?.status === "draining" ? "draining" : "running",
	...optionalSubject(record?.subject ?? run.subject),
	...(record?.display === undefined
		? run.display === undefined
			? {}
			: { display: run.display }
		: { display: record.display }),
	...(record?.blockedReason === undefined
		? {}
		: { blockedReason: record.blockedReason }),
	...(record?.operatorActions === undefined
		? {}
		: { operatorActions: record.operatorActions }),
	currentRunId: run.runId,
});
const applyWorkProposals = (
	work: ReadonlyMap<WorkKey, WorkRecord>,
	running: ReadonlyMap<WorkKey, WorkRun>,
	proposals: readonly ReconcileProposal[],
) => {
	const next = new Map(work);
	const interruptedKeys = new Set(
		proposals.flatMap((proposal) =>
			proposal.type === "interrupt_work" ? [proposal.workKey] : [],
		),
	);
	for (const proposal of proposals) {
		if (proposal.type === "upsert_work") {
			const active = running.get(proposal.work.workKey);
			next.set(
				proposal.work.workKey,
				active === undefined
					? proposal.work
					: activeWorkRecord(active, proposal.work),
			);
		} else if (proposal.type === "remove_work") {
			const active = running.get(proposal.workKey);
			if (active === undefined || interruptedKeys.has(proposal.workKey))
				next.delete(proposal.workKey);
			else
				next.set(
					proposal.workKey,
					activeWorkRecord(active, next.get(proposal.workKey)),
				);
		}
	}
	return next;
};
const beginTick = (
	state: RuntimeState,
	drained: DrainedMessages,
	stalledRuns: readonly TimedOutRun[],
	historyLimit: number,
) => {
	const running = new Map(state.running),
		work = new Map(state.work),
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
	const timedOut: TimedOutRun[] = [
		...drained.timedOutRuns.map((run) => ({
			run,
			error: "work run timed out",
		})),
		...stalledRuns,
	];
	for (const { run: timedOutRun, error } of timedOut) {
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
			error,
		};
		completions.push(completion);
		const d = completionDiagnostic(completion);
		if (d) diagnostics.push(d);
	}
	for (const interruption of drained.interruptions) {
		const matches = [...running.values()].filter(
			(run) =>
				run.runId === interruption.runId &&
				(interruption.workKey === undefined ||
					run.workKey === interruption.workKey),
		);
		for (const run of matches) {
			running.delete(run.workKey);
			completedRuns.push(run);
			const completion: Completion = {
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "interrupted",
				...optionalSubject(run.subject),
				error: "work run interrupted by controller request",
			};
			completions.push(completion);
			const d = completionDiagnostic(completion);
			if (d) diagnostics.push(d);
		}
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
	for (const completion of completions) {
		const record = work.get(completion.workKey);
		if (record?.currentRunId !== completion.runId) continue;
		work.set(completion.workKey, {
			workKey: record.workKey,
			sourceId: record.sourceId,
			status: completion.status === "succeeded" ? "done" : "failed",
			...(record.subject === undefined ? {} : { subject: record.subject }),
			...(record.display === undefined ? {} : { display: record.display }),
			...(record.blockedReason === undefined
				? {}
				: { blockedReason: record.blockedReason }),
			...(record.operatorActions === undefined
				? {}
				: { operatorActions: record.operatorActions }),
		});
	}
	const now = Date.now();
	const next = boundStateHistory(
		{
			...state,
			tickId: state.tickId + 1,
			observations: [...state.observations, ...drained.observations],
			completions: [...state.completions, ...completions],
			diagnostics: [...state.diagnostics, ...diagnostics],
			work,
			running,
			scheduledWakes: [
				...state.scheduledWakes.filter((wake) => wake.dueAtMs > now),
				...drained.requestedWakes.filter((wake) => wake.dueAtMs > now),
			].toSorted((a, b) => a.dueAtMs - b.dueAtMs),
		},
		historyLimit,
	);
	return {
		state: next,
		completions,
		diagnostics,
		completedRuns,
	};
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
			work: applyWorkProposals(state.work, state.running, proposals),
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
		work = new Map(state.work),
		completions: Completion[] = [],
		diagnostics: Diagnostic[] = [],
		interruptedRuns: WorkRun[] = [],
		interruptedKeys = new Set<WorkKey>();
	for (const proposal of proposals) {
		const run = running.get(proposal.workKey);
		if (!run) continue;
		running.delete(proposal.workKey);
		const record = work.get(proposal.workKey);
		if (record?.currentRunId === run.runId)
			work.set(proposal.workKey, {
				workKey: record.workKey,
				sourceId: record.sourceId,
				status: "pending",
				...(record.subject === undefined ? {} : { subject: record.subject }),
				...(record.display === undefined ? {} : { display: record.display }),
				...(record.blockedReason === undefined
					? {}
					: { blockedReason: record.blockedReason }),
				...(record.operatorActions === undefined
					? {}
					: { operatorActions: record.operatorActions }),
			});
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
				work,
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
const startEligibleRuns = (
	state: RuntimeState,
	selected: readonly WorkSelection[],
	maxConcurrentRuns: number,
	blockedThisTick: ReadonlySet<WorkKey> = new Set(),
) => {
	const running = new Map(state.running),
		workRecords = new Map(state.work),
		runningBySource = runningCountBySource(running),
		started: { run: WorkRun; selection: WorkSelection }[] = [],
		skipped: SkippedWork[] = [],
		seen = new Set<WorkKey>();
	let nextRunIndex = state.nextRunIndex;
	const capacity = Math.max(0, maxConcurrentRuns - running.size);
	const skip = (
		selection: WorkSelection,
		reason: SkippedWork["reason"],
		detail?: string,
	) =>
		skipped.push({
			workKey: selection.work.workKey,
			sourceId: selection.source.id,
			reason,
			...(detail === undefined ? {} : { detail }),
		});
	for (const selection of selected.toSorted((a, b) =>
		String(a.work.workKey).localeCompare(String(b.work.workKey)),
	)) {
		const { work } = selection;
		if (seen.has(work.workKey)) {
			skip(selection, "duplicate_in_tick");
			continue;
		}
		seen.add(work.workKey);
		if (blockedThisTick.has(work.workKey)) {
			skip(selection, "interrupted_this_tick");
			continue;
		}
		if (running.has(work.workKey)) {
			skip(selection, "already_running");
			continue;
		}
		if (started.length >= capacity) {
			skip(
				selection,
				"capacity_exhausted",
				`maxConcurrentRuns ${maxConcurrentRuns}`,
			);
			continue;
		}
		const maxRuns = selection.source.policy?.maxConcurrentRuns;
		if (
			maxRuns !== undefined &&
			(runningBySource.get(selection.source.id) ?? 0) >= maxRuns
		) {
			skip(selection, "source_concurrency", `maxConcurrentRuns ${maxRuns}`);
			continue;
		}
		const run: WorkRun = {
			runId: `run-${nextRunIndex}`,
			sourceId: selection.source.id,
			workKey: work.workKey,
			...optionalSubject(work.subject),
			...(work.display === undefined ? {} : { display: work.display }),
		};
		nextRunIndex++;
		running.set(work.workKey, run);
		const previous = workRecords.get(work.workKey);
		const display = work.display ?? previous?.display;
		const operatorActions = work.operatorActions ?? previous?.operatorActions;
		workRecords.set(work.workKey, {
			workKey: work.workKey,
			sourceId: selection.source.id,
			status: "running",
			...optionalSubject(work.subject ?? previous?.subject),
			...(display === undefined ? {} : { display }),
			...(operatorActions === undefined ? {} : { operatorActions }),
			currentRunId: run.runId,
		});
		runningBySource.set(
			selection.source.id,
			(runningBySource.get(selection.source.id) ?? 0) + 1,
		);
		started.push({ run, selection });
	}
	return {
		state: { ...state, work: workRecords, running, nextRunIndex },
		started,
		skipped,
	};
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
	let state = initialState,
		snapshotCache = snapshotFrom(initialState),
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
		runHandles = new Map<WorkKey, RunHandle>(),
		timers = new Set<AbortController>(),
		stallTimers = new Map<Domain.RunId, AbortController>(),
		// Last emitObservation per active run; drives stall detection.
		lastActivityAt = new Map<Domain.RunId, number>();
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
	const interruptRunHandles = (runs: readonly WorkRun[]) => {
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
		const completions = completedRuns.map(
			(run): Completion => ({
				runId: run.runId,
				sourceId: run.sourceId,
				workKey: run.workKey,
				status: "interrupted",
				...optionalSubject(run.subject),
				error: "work run interrupted by plot agent shutdown",
			}),
		);
		const diagnostics = completions.flatMap((completion) => {
			const d = completionDiagnostic(completion);
			return d === undefined ? [] : [d];
		});
		const work = new Map(state.work);
		for (const completion of completions) {
			const record = work.get(completion.workKey);
			if (record?.currentRunId !== completion.runId) continue;
			work.set(completion.workKey, {
				workKey: record.workKey,
				sourceId: record.sourceId,
				status: "failed",
				...(record.subject === undefined ? {} : { subject: record.subject }),
				...(record.display === undefined ? {} : { display: record.display }),
				...(record.blockedReason === undefined
					? {}
					: { blockedReason: record.blockedReason }),
				...(record.operatorActions === undefined
					? {}
					: { operatorActions: record.operatorActions }),
			});
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
		f: (() => Promise<readonly A[]> | readonly A[]) | undefined,
		fallback: readonly A[],
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
			const result = await runner.run({
				sourceId: selection.source.id,
				tickId: runSnapshot.tickId,
				run,
				work: selection.work,
				snapshot: runSnapshot,
				signal,
				emitObservation,
				...(shouldContinue === undefined ? {} : { shouldContinue }),
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
			offerControl({ type: "run_completed", run, completion });
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
			offerControl({ type: "run_completed", run, completion });
		}
	};
	const runTickUnsafe = async (
		initialMessages: readonly InternalMessage[] = [],
	) =>
		withWideEvent("plot_agent.tick", {}, async () => {
			const controller = new AbortController();
			currentTickController = controller;
			const signal = controller.signal;
			const aborted = () => signal.aborted || stoppingOrStopped();
			const noDispatchResult = (
				tickId: Domain.TickId,
				input: {
					readonly observations?: readonly Observation[];
					readonly proposals?: readonly ReconcileProposal[];
					readonly completions?: readonly Completion[];
					readonly diagnostics?: readonly Diagnostic[];
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
	const runTick = (messages: readonly InternalMessage[] = []) => {
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
	const api: PlotAgentShape = {
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
			const message = {
				type: "interrupt_run" as const,
				runId: input.runId,
				...(input.workKey === undefined ? {} : { workKey: input.workKey }),
			};
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
				...(reason === undefined ? {} : { reason }),
			};
			// State is only mutated inside the tick chain; record the wake via
			// the mailbox so a mid-flight tick cannot overwrite it.
			offerControl({ type: "wake_requested", wake });
			publishEvent({
				type: "wake_scheduled",
				delayMs: safeDelay,
				...(reason === undefined ? {} : { reason }),
			});
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
