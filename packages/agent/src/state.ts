import { errorMessage } from "@plot/common/primitives";
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
	ScheduledWake,
	ScheduleWakeProposal,
	SkippedWork,
	WorkItem,
	WorkRecord,
	WorkRun,
} from "./model.js";
import type { WorkSource } from "./work-source.js";

export interface RuntimeState {
	tickId: number;
	facts: Map<string, unknown>;
	observations: Observation[];
	completions: Completion[];
	diagnostics: Diagnostic[];
	work: Map<string, WorkRecord>;
	running: Map<string, WorkRun>;
	scheduledWakes: ScheduledWake[];
	nextRunIndex: number;
	runIdPrefix: string;
}
export interface TimedOutRun {
	run: WorkRun;
	error: string;
}
export type AgentLifecycle = "new" | "running" | "stopping" | "stopped";

export type InternalMessage =
	| PlotAgentMessage
	| {
			type: "run_completed";
			run: WorkRun;
			completion: Completion;
	  }
	| { type: "scheduled_tick"; token: number }
	| { type: "wake" }
	| { type: "wake_requested"; wake: ScheduledWake }
	| { type: "run_timeout"; run: WorkRun }
	| {
			type: "interrupt_run";
			runId: string;
			workKey?: string;
	  };
export interface DrainedMessages {
	observations: Observation[];
	completions: {
		run: WorkRun;
		completion: Completion;
	}[];
	timedOutRuns: WorkRun[];
	interruptions: {
		runId: string;
		workKey?: string;
	}[];
	requestedWakes: ScheduledWake[];
	shutdownRequested: boolean;
}
export interface WorkSelection {
	source: WorkSource;
	work: WorkItem;
}
export interface RunHandle {
	run: WorkRun;
	controller: AbortController;
}

export const initialRuntimeState = (runIdPrefix: string): RuntimeState => ({
	tickId: 0,
	facts: new Map(),
	observations: [],
	completions: [],
	diagnostics: [],
	work: new Map(),
	running: new Map(),
	scheduledWakes: [],
	nextRunIndex: 0,
	runIdPrefix,
});

export const boundStateHistory = (
	state: RuntimeState,
	limit: number,
): RuntimeState => ({
	...state,
	observations: state.observations.slice(-limit),
	completions: state.completions.slice(-limit),
	diagnostics: state.diagnostics.slice(-limit),
});

export const hookDiagnostic = (
	phase: HookPhase,
	sourceId: string,
	error: unknown,
): Diagnostic => ({
	level: "error",
	phase,
	sourceId,
	message: errorMessage(error),
});
export const completionDiagnostic = (
	completion: Completion,
): Diagnostic | undefined =>
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

export const completionFor = (
	run: WorkRun,
	status: Completion["status"],
	result: Partial<Pick<Completion, "error" | "output">> = {},
): Completion =>
	({
		runId: run.runId,
		sourceId: run.sourceId,
		workKey: run.workKey,
		status,
		subject: run.subject,
		...result,
	}) as Completion;

export const pendingWorkRecord = (record: WorkRecord): WorkRecord =>
	({
		...record,
		status: "pending",
		currentRunId: undefined,
	}) as unknown as WorkRecord;
export const snapshotFrom = (state: RuntimeState): RuntimeSnapshot => ({
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
export const drainMessages = (messages: InternalMessage[]): DrainedMessages => {
	const observations: Observation[] = [],
		completions: { run: WorkRun; completion: Completion }[] = [],
		timedOutRuns: WorkRun[] = [],
		interruptions: { runId: string; workKey?: string }[] = [],
		requestedWakes: ScheduledWake[] = [];
	let shutdownRequested = false;
	for (const message of messages) {
		if (message.type === "observation") observations.push(message.observation);
		else if (message.type === "run_completed")
			completions.push({ run: message.run, completion: message.completion });
		else if (message.type === "run_timeout") timedOutRuns.push(message.run);
		else if (message.type === "interrupt_run") {
			const interruption: { runId: string; workKey?: string } = {
				runId: message.runId,
			};
			if (message.workKey !== undefined) interruption.workKey = message.workKey;
			interruptions.push(interruption);
		} else if (message.type === "wake_requested")
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
	facts: Map<string, unknown>,
	proposals: ReconcileProposal[],
) => {
	const next = new Map(facts);
	for (const proposal of proposals) {
		if (proposal.type === "set_fact") next.set(proposal.key, proposal.value);
	}
	return next;
};

// Reconciliation can update display metadata, but active Agent Runs stay
// Plot-owned until completion, timeout, shutdown, or an interrupt_work proposal.
const activeWorkRecord = (
	run: WorkRun,
	record: WorkRecord | undefined,
): WorkRecord =>
	({
		...record,
		workKey: run.workKey,
		sourceId: run.sourceId,
		status: record?.status === "draining" ? "draining" : "running",
		currentRunId: run.runId,
		subject: record?.subject ?? run.subject,
		display: record?.display ?? run.display,
	}) as WorkRecord;
const applyWorkProposals = (
	work: Map<string, WorkRecord>,
	running: Map<string, WorkRun>,
	proposals: ReconcileProposal[],
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
export const beginTick = (
	state: RuntimeState,
	drained: DrainedMessages,
	stalledRuns: TimedOutRun[],
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
		const completion = completionFor(timedOutRun, "timed_out", { error });
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
			const completion = completionFor(run, "interrupted", {
				error: "work run interrupted by controller request",
			});
			completions.push(completion);
			const d = completionDiagnostic(completion);
			if (d) diagnostics.push(d);
		}
	}
	if (drained.shutdownRequested)
		for (const run of running.values()) {
			running.delete(run.workKey);
			completedRuns.push(run);
			const completion = completionFor(run, "interrupted", {
				error: "work run interrupted by plot agent shutdown",
			});
			completions.push(completion);
			const d = completionDiagnostic(completion);
			if (d) diagnostics.push(d);
		}
	for (const completion of completions) {
		const record = work.get(completion.workKey);
		if (record?.currentRunId !== completion.runId) continue;
		work.set(completion.workKey, pendingWorkRecord(record));
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
export const applyObserved = (
	state: RuntimeState,
	observations: Observation[],
	diagnostics: Diagnostic[],
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
const wakeFromProposal = (
	proposal: ScheduleWakeProposal,
	now: number,
): ScheduledWake =>
	({
		dueAtMs: now + proposal.delayMs,
		delayMs: proposal.delayMs,
		reason: proposal.reason,
		workKey: proposal.workKey,
		attempt: proposal.attempt,
	}) as ScheduledWake;

export const wakeScheduledEvent = (
	proposal: ScheduleWakeProposal,
): PlotAgentEvent =>
	({
		type: "wake_scheduled",
		delayMs: proposal.delayMs,
		reason: proposal.reason,
		workKey: proposal.workKey,
		attempt: proposal.attempt,
	}) as PlotAgentEvent;

export const applyReconciled = (
	state: RuntimeState,
	proposals: ReconcileProposal[],
	diagnostics: Diagnostic[],
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
export const applyDiagnostics = (
	state: RuntimeState,
	diagnostics: Diagnostic[],
	historyLimit: number,
): RuntimeState =>
	boundStateHistory(
		{ ...state, diagnostics: [...state.diagnostics, ...diagnostics] },
		historyLimit,
	);
export const interruptRunningWork = (
	state: RuntimeState,
	proposals: InterruptWorkProposal[],
	historyLimit: number,
) => {
	const running = new Map(state.running),
		work = new Map(state.work),
		completions: Completion[] = [],
		diagnostics: Diagnostic[] = [],
		interruptedRuns: WorkRun[] = [],
		interruptedKeys = new Set<string>();
	for (const proposal of proposals) {
		const run = running.get(proposal.workKey);
		if (!run) continue;
		running.delete(proposal.workKey);
		const record = work.get(proposal.workKey);
		if (record?.currentRunId === run.runId)
			work.set(proposal.workKey, pendingWorkRecord(record));
		interruptedRuns.push(run);
		interruptedKeys.add(proposal.workKey);
		const completion = completionFor(run, "interrupted", {
			error: proposal.reason ?? "work run interrupted by source proposal",
		});
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
const runningCountBySource = (running: Map<string, WorkRun>) => {
	const counts = new Map<string, number>();
	for (const run of running.values())
		counts.set(run.sourceId, (counts.get(run.sourceId) ?? 0) + 1);
	return counts;
};
export const startEligibleRuns = (
	state: RuntimeState,
	selected: WorkSelection[],
	maxConcurrentRuns: number,
	blockedThisTick: Set<string> = new Set(),
) => {
	const running = new Map(state.running),
		workRecords = new Map(state.work),
		runningBySource = runningCountBySource(running),
		started: { run: WorkRun; selection: WorkSelection }[] = [],
		skipped: SkippedWork[] = [],
		seen = new Set<string>();
	let nextRunIndex = state.nextRunIndex;
	const capacity = Math.max(0, maxConcurrentRuns - running.size);
	const skip = (
		selection: WorkSelection,
		reason: SkippedWork["reason"],
		detail?: string,
	) => {
		skipped.push({
			workKey: selection.work.workKey,
			sourceId: selection.source.id,
			reason,
			detail,
		} as SkippedWork);
	};
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
		const run = {
			runId: `${state.runIdPrefix}-${nextRunIndex}`,
			sourceId: selection.source.id,
			workKey: work.workKey,
			subject: work.subject,
			display: work.display,
		} as WorkRun;
		nextRunIndex++;
		running.set(work.workKey, run);
		const previous = workRecords.get(work.workKey);
		const display = work.display ?? previous?.display;
		const subject = work.subject ?? previous?.subject;
		const operatorActions = work.operatorActions ?? previous?.operatorActions;
		workRecords.set(work.workKey, {
			workKey: work.workKey,
			sourceId: selection.source.id,
			status: "running",
			currentRunId: run.runId,
			subject,
			display,
			operatorActions,
		} as WorkRecord);
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
