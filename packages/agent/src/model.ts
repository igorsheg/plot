export const positiveInt = (value: number): number => {
	if (!Number.isInteger(value) || value < 1)
		throw new Error("expected positive integer");
	return value;
};

export const tickId = (value: number): number => {
	if (!Number.isInteger(value) || value < 0)
		throw new Error("expected non-negative integer");
	return value;
};

const identifier = (value: string, name: string): string => {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		!/^[A-Za-z0-9._:-]+$/.test(value)
	) {
		throw new Error(`invalid ${name}`);
	}
	return value;
};

const nonEmpty = (value: string, name: string): string => {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`invalid ${name}`);
	return value;
};

export const sourceId = (value: string): string =>
	identifier(value, "SourceId");
export const subjectKey = (value: string): string =>
	nonEmpty(value, "SubjectKey");
export const workKey = (value: string): string => nonEmpty(value, "WorkKey");
export const runId = (value: string): string => identifier(value, "RunId");

export type AgentPhase =
	| "setup"
	| "observe"
	| "reconcile"
	| "select"
	| "act"
	| "policy";
export type HookPhase = "observe" | "reconcile" | "select";

export class PlotAgentError extends Error {
	readonly phase: AgentPhase;
	readonly source_id?: string;
	constructor(input: {
		readonly phase: AgentPhase;
		readonly message: string;
		readonly source_id?: string;
	}) {
		super(input.message);
		this.name = "PlotAgentError";
		this.phase = input.phase;
		if (input.source_id !== undefined) this.source_id = input.source_id;
	}
}

export interface Observation {
	readonly type: string;
	readonly subject?: string;
	readonly data?: unknown;
}
export interface SetFactProposal {
	readonly type: "set_fact";
	readonly key: string;
	readonly value: unknown;
}
export const setFact = (key: string, value: unknown): SetFactProposal => ({
	type: "set_fact",
	key,
	value,
});
export interface RemoveFactProposal {
	readonly type: "remove_fact";
	readonly key: string;
}
export const removeFact = (key: string): RemoveFactProposal => ({
	type: "remove_fact",
	key,
});
export interface InterruptWorkProposal {
	readonly type: "interrupt_work";
	readonly workKey: string;
	readonly reason?: string;
}
export const interruptWork = (
	key: string,
	reason?: string,
): InterruptWorkProposal => ({
	type: "interrupt_work",
	workKey: key,
	...(reason === undefined ? {} : { reason }),
});
export interface ScheduleWakeOptions {
	readonly reason?: string;
	readonly workKey?: string;
	readonly attempt?: number;
}
export interface ScheduleWakeProposal {
	readonly type: "schedule_wake";
	readonly delayMs: number;
	readonly reason?: string;
	readonly workKey?: string;
	readonly attempt?: number;
}
export const scheduleWake = (
	delayMs: number,
	reasonOrOptions?: string | ScheduleWakeOptions,
): ScheduleWakeProposal => {
	const options =
		typeof reasonOrOptions === "string"
			? { reason: reasonOrOptions }
			: (reasonOrOptions ?? {});
	return {
		type: "schedule_wake",
		delayMs: positiveInt(delayMs),
		...(options.reason === undefined ? {} : { reason: options.reason }),
		...(options.workKey === undefined ? {} : { workKey: options.workKey }),
		...(options.attempt === undefined
			? {}
			: { attempt: positiveInt(options.attempt) }),
	};
};

export interface WorkDisplay {
	readonly kind?: string;
	readonly primary?: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly version?: string;
	readonly labels?: readonly string[];
}
export interface OperatorActionConfirm {
	readonly title: string;
	readonly message?: string;
}
export interface OperatorAction {
	readonly id: string;
	readonly label: string;
	readonly tone?: "primary" | "secondary" | "danger";
	readonly disabledReason?: string;
	readonly requiresComment?: boolean;
	readonly confirm?: OperatorActionConfirm;
}
export type WorkStatus =
	| "pending"
	| "waiting"
	| "running"
	| "blocked"
	| "draining"
	| "done"
	| "failed";

export interface WorkRecord {
	readonly workKey: string;
	readonly sourceId: string;
	readonly status: WorkStatus;
	readonly subject?: string;
	readonly display?: WorkDisplay;
	readonly blockedReason?: string;
	readonly operatorActions?: readonly OperatorAction[];
	readonly currentRunId?: string;
}

export interface UpsertWorkProposal {
	readonly type: "upsert_work";
	readonly work: WorkRecord;
}
export const upsertWork = (work: WorkRecord): UpsertWorkProposal => ({
	type: "upsert_work",
	work,
});

export interface RemoveWorkProposal {
	readonly type: "remove_work";
	readonly workKey: string;
}
export const removeWork = (key: string): RemoveWorkProposal => ({
	type: "remove_work",
	workKey: key,
});

export type ReconcileProposal =
	| SetFactProposal
	| RemoveFactProposal
	| InterruptWorkProposal
	| ScheduleWakeProposal
	| UpsertWorkProposal
	| RemoveWorkProposal;

export interface WorkItem {
	readonly workKey: string;
	readonly subject?: string;
	readonly templateContext?: unknown;
	readonly display?: WorkDisplay;
	readonly operatorActions?: readonly OperatorAction[];
}
export interface WorkRun {
	readonly runId: string;
	readonly sourceId: string;
	readonly workKey: string;
	readonly subject?: string;
	readonly display?: WorkDisplay;
}
export interface WorkResult {
	readonly output?: unknown;
}
export type CompletionStatus =
	| "succeeded"
	| "failed"
	| "interrupted"
	| "timed_out";
export interface Completion {
	readonly runId: string;
	readonly sourceId: string;
	readonly workKey: string;
	readonly status: CompletionStatus;
	readonly subject?: string;
	readonly output?: unknown;
	readonly error?: string;
}
export interface Diagnostic {
	readonly level: "info" | "warning" | "error";
	readonly phase: HookPhase | "act" | "policy";
	readonly message: string;
	readonly sourceId?: string;
	readonly runId?: string;
	readonly workKey?: string;
}
export interface ScheduledWake {
	readonly dueAtMs: number;
	readonly delayMs: number;
	readonly reason?: string;
	readonly workKey?: string;
	readonly attempt?: number;
}
export type WorkSkipReason =
	| "already_running"
	| "duplicate_in_tick"
	| "interrupted_this_tick"
	| "capacity_exhausted"
	| "source_concurrency";
export interface SkippedWork {
	readonly workKey: string;
	readonly sourceId: string;
	readonly reason: WorkSkipReason;
	readonly detail?: string;
}
export interface RuntimeSnapshot {
	readonly tickId: number;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly work: ReadonlyMap<string, WorkRecord>;
	readonly running: ReadonlyMap<string, WorkRun>;
	readonly scheduledWakes?: readonly ScheduledWake[];
}
export interface TickResult {
	readonly tickId: number;
	readonly observations: readonly Observation[];
	readonly proposals: readonly ReconcileProposal[];
	readonly selected: readonly WorkItem[];
	readonly started: readonly WorkRun[];
	readonly skipped: readonly SkippedWork[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly snapshot: RuntimeSnapshot;
}
export type PlotAgentEvent =
	| { readonly type: "tick_started"; readonly tickId: number }
	| { readonly type: "tick_completed"; readonly result: TickResult }
	| { readonly type: "work_observed"; readonly work: WorkRecord }
	| { readonly type: "work_removed"; readonly workKey: string }
	| {
			readonly type: "wake_scheduled";
			readonly delayMs: number;
			readonly reason?: string;
			readonly workKey?: string;
			readonly attempt?: number;
	  }
	| { readonly type: "attempt_started"; readonly run: WorkRun }
	| { readonly type: "attempt_completed"; readonly completion: Completion };
export type PlotAgentMessage =
	| { readonly type: "tick" }
	| { readonly type: "observation"; readonly observation: Observation }
	| { readonly type: "shutdown" };
