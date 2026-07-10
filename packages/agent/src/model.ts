import type { OperatorAction, WorkDisplay } from "@plot/sdk/work-contract";

export type {
	OperatorAction,
	OperatorActionConfirm,
	WorkDisplay,
} from "@plot/sdk/work-contract";

export type HookPhase = "observe" | "reconcile" | "select";

export interface Observation {
	type: string;
	subject?: string;
	data?: unknown;
}
export interface SetFactProposal {
	type: "set_fact";
	key: string;
	value: unknown;
}
export const setFact = (key: string, value: unknown): SetFactProposal => ({
	type: "set_fact",
	key,
	value,
});
export interface InterruptWorkProposal {
	type: "interrupt_work";
	workKey: string;
	reason?: string;
}
export const interruptWork = (
	key: string,
	reason?: string,
): InterruptWorkProposal =>
	({ type: "interrupt_work", workKey: key, reason }) as InterruptWorkProposal;
export interface ScheduleWakeOptions {
	reason?: string;
	workKey?: string;
	attempt?: number;
}
export interface ScheduleWakeProposal {
	type: "schedule_wake";
	delayMs: number;
	reason?: string;
	workKey?: string;
	attempt?: number;
}
export const scheduleWake = (
	delayMs: number,
	reasonOrOptions?: string | ScheduleWakeOptions,
): ScheduleWakeProposal => {
	const options =
		typeof reasonOrOptions === "string"
			? { reason: reasonOrOptions }
			: reasonOrOptions;
	return { type: "schedule_wake", delayMs, ...options };
};

export type WorkStatus =
	| "pending"
	| "waiting"
	| "running"
	| "blocked"
	| "draining";

export interface WorkRecord {
	workKey: string;
	sourceId: string;
	status: WorkStatus;
	subject?: string;
	display?: WorkDisplay;
	blockedReason?: string;
	operatorActions?: OperatorAction[];
	currentRunId?: string;
}

export interface UpsertWorkProposal {
	type: "upsert_work";
	work: WorkRecord;
}
export const upsertWork = (work: WorkRecord): UpsertWorkProposal => ({
	type: "upsert_work",
	work,
});

export interface RemoveWorkProposal {
	type: "remove_work";
	workKey: string;
}
export const removeWork = (key: string): RemoveWorkProposal => ({
	type: "remove_work",
	workKey: key,
});

export type ReconcileProposal =
	| SetFactProposal
	| InterruptWorkProposal
	| ScheduleWakeProposal
	| UpsertWorkProposal
	| RemoveWorkProposal;

export interface WorkItem {
	workKey: string;
	subject?: string;
	templateContext?: unknown;
	display?: WorkDisplay;
	operatorActions?: OperatorAction[];
}
export interface WorkRun {
	runId: string;
	sourceId: string;
	workKey: string;
	subject?: string;
	display?: WorkDisplay;
}
export interface WorkResult {
	output?: unknown;
}
export type CompletionStatus =
	| "succeeded"
	| "failed"
	| "interrupted"
	| "timed_out";
export interface Completion {
	runId: string;
	sourceId: string;
	workKey: string;
	status: CompletionStatus;
	subject?: string;
	output?: unknown;
	error?: string;
}
export interface Diagnostic {
	level: "info" | "warning" | "error";
	phase: HookPhase | "act" | "policy";
	message: string;
	sourceId?: string;
	runId?: string;
	workKey?: string;
}
export interface ScheduledWake {
	dueAtMs: number;
	delayMs: number;
	reason?: string;
	workKey?: string;
	attempt?: number;
}
export type WorkSkipReason =
	| "already_running"
	| "duplicate_in_tick"
	| "interrupted_this_tick"
	| "capacity_exhausted"
	| "source_concurrency";
export interface SkippedWork {
	workKey: string;
	sourceId: string;
	reason: WorkSkipReason;
	detail?: string;
}
export interface RuntimeSnapshot {
	tickId: number;
	facts: Map<string, unknown>;
	observations: Observation[];
	completions: Completion[];
	diagnostics: Diagnostic[];
	work: Map<string, WorkRecord>;
	running: Map<string, WorkRun>;
	scheduledWakes?: ScheduledWake[];
}
export interface TickResult {
	tickId: number;
	observations: Observation[];
	proposals: ReconcileProposal[];
	selected: WorkItem[];
	started: WorkRun[];
	skipped: SkippedWork[];
	completions: Completion[];
	diagnostics: Diagnostic[];
	snapshot: RuntimeSnapshot;
}
export type PlotAgentEvent =
	| { type: "tick_started"; tickId: number }
	| { type: "tick_completed"; result: TickResult }
	| { type: "work_observed"; work: WorkRecord }
	| { type: "work_removed"; workKey: string }
	| {
			type: "wake_scheduled";
			delayMs: number;
			reason?: string;
			workKey?: string;
			attempt?: number;
	  }
	| { type: "attempt_started"; run: WorkRun }
	| { type: "attempt_completed"; completion: Completion };
export type PlotAgentMessage =
	| { type: "tick" }
	| { type: "observation"; observation: Observation }
	| { type: "shutdown" };
