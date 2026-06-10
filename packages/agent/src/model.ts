export type PositiveInt = number;
export const positiveInt = (value: number): PositiveInt => {
	if (!Number.isInteger(value) || value < 1)
		throw new Error("expected positive integer");
	return value;
};

export type TickId = number;
export const tickId = (value: number): TickId => {
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

export type SourceId = string;
export const sourceId = (value: string): SourceId =>
	identifier(value, "SourceId");
export type SubjectKey = string;
export const subjectKey = (value: string): SubjectKey =>
	nonEmpty(value, "SubjectKey");
export type WorkKey = string;
export const workKey = (value: string): WorkKey => nonEmpty(value, "WorkKey");
export type RunId = string;
export const runId = (value: string): RunId => identifier(value, "RunId");

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
	readonly source_id?: SourceId;
	constructor(input: {
		readonly phase: AgentPhase;
		readonly message: string;
		readonly source_id?: SourceId;
	}) {
		super(input.message);
		this.name = "PlotAgentError";
		this.phase = input.phase;
		if (input.source_id !== undefined) this.source_id = input.source_id;
	}
}

export interface Observation {
	readonly type: string;
	readonly subject?: SubjectKey;
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
	readonly workKey: WorkKey;
	readonly reason?: string;
}
export const interruptWork = (
	key: WorkKey,
	reason?: string,
): InterruptWorkProposal => ({
	type: "interrupt_work",
	workKey: key,
	...(reason === undefined ? {} : { reason }),
});
export interface ScheduleWakeProposal {
	readonly type: "schedule_wake";
	readonly delayMs: PositiveInt;
	readonly reason?: string;
}
export const scheduleWake = (
	delayMs: number,
	reason?: string,
): ScheduleWakeProposal => ({
	type: "schedule_wake",
	delayMs: positiveInt(delayMs),
	...(reason === undefined ? {} : { reason }),
});
export type ReconcileProposal =
	| SetFactProposal
	| RemoveFactProposal
	| InterruptWorkProposal
	| ScheduleWakeProposal;

export interface WorkItem {
	readonly workKey: WorkKey;
	readonly subject?: SubjectKey;
	readonly templateContext?: unknown;
}
export interface WorkRun {
	readonly runId: RunId;
	readonly sourceId: SourceId;
	readonly workKey: WorkKey;
	readonly subject?: SubjectKey;
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
	readonly runId: RunId;
	readonly sourceId: SourceId;
	readonly workKey: WorkKey;
	readonly status: CompletionStatus;
	readonly subject?: SubjectKey;
	readonly output?: unknown;
	readonly error?: string;
}
export interface Diagnostic {
	readonly level: "info" | "warning" | "error";
	readonly phase: HookPhase | "act" | "policy";
	readonly message: string;
	readonly sourceId?: SourceId;
	readonly runId?: RunId;
	readonly workKey?: WorkKey;
}
export interface RuntimeSnapshot {
	readonly tickId: TickId;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly running: ReadonlyMap<WorkKey, WorkRun>;
}
export interface TickResult {
	readonly tickId: TickId;
	readonly observations: readonly Observation[];
	readonly proposals: readonly ReconcileProposal[];
	readonly selected: readonly WorkItem[];
	readonly started: readonly WorkRun[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly snapshot: RuntimeSnapshot;
}
export type PlotAgentEvent =
	| { readonly type: "tick_started"; readonly tickId: TickId }
	| { readonly type: "tick_completed"; readonly result: TickResult }
	| {
			readonly type: "wake_scheduled";
			readonly delayMs: PositiveInt;
			readonly reason?: string;
	  }
	| { readonly type: "work_started"; readonly run: WorkRun }
	| { readonly type: "work_completed"; readonly completion: Completion };
export type PlotAgentMessage =
	| { readonly type: "tick" }
	| { readonly type: "observation"; readonly observation: Observation }
	| { readonly type: "shutdown" };
