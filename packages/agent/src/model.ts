import type { OperatorAction, WorkDisplay } from "@plot/sdk/work-contract";

export type {
	OperatorAction,
	OperatorActionConfirm,
	WorkDisplay,
} from "@plot/sdk/work-contract";

export interface Observation {
	readonly type: string;
	readonly subject?: string;
	readonly data?: unknown;
}

export type SourceRequirementRecord =
	| {
			readonly id: string;
			readonly label: string;
			readonly status: "checking" | "ready";
	  }
	| {
			readonly id: string;
			readonly label: string;
			readonly status: "action-required";
			readonly message: string;
			readonly actions: readonly OperatorAction[];
	  }
	| {
			readonly id: string;
			readonly label: string;
			readonly status: "unavailable";
			readonly message: string;
			readonly retryAfterMs?: number;
	  };

export type SourceReadinessStatus = SourceRequirementRecord["status"];

export interface SourceRecord {
	readonly sourceId: string;
	readonly label: string;
	readonly readiness: SourceReadinessStatus;
	readonly message?: string;
	readonly requirements: readonly SourceRequirementRecord[];
}

interface WorkIdentity {
	readonly workKey: string;
	readonly sourceId: string;
	readonly subject?: string;
	readonly display?: WorkDisplay;
}

export type SourceWorkRecord =
	| (WorkIdentity & {
			readonly status: "pending";
			readonly operatorActions?: readonly OperatorAction[];
	  })
	| (WorkIdentity & {
			readonly status: "waiting";
			readonly reason?: string;
			readonly operatorActions?: readonly OperatorAction[];
	  })
	| (WorkIdentity & {
			readonly status: "blocked";
			readonly reason: string;
			readonly operatorActions: readonly OperatorAction[];
	  });

export type WorkRecord =
	| SourceWorkRecord
	| (WorkIdentity & {
			readonly status: "running" | "draining";
			readonly runId: string;
			readonly operatorActions?: readonly OperatorAction[];
	  });

export interface WorkItem {
	readonly workKey: string;
	readonly subject?: string;
	readonly templateContext?: unknown;
	/** Source-owned data retained with the selected item for lifecycle hooks. */
	readonly sourceData?: unknown;
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

interface CompletionIdentity {
	readonly runId: string;
	readonly sourceId: string;
	readonly workKey: string;
	readonly subject?: string;
}

export type Completion =
	| (CompletionIdentity & {
			readonly status: "succeeded";
			readonly output?: unknown;
	  })
	| (CompletionIdentity & {
			readonly status: "failed";
			readonly error: string;
	  })
	| (CompletionIdentity & {
			readonly status: "interrupted";
			readonly reason: string;
	  })
	| (CompletionIdentity & {
			readonly status: "timed_out";
			readonly reason: string;
	  });

export interface Diagnostic {
	readonly level: "info" | "warning" | "error";
	readonly phase: "observe" | "reconcile" | "act";
	readonly message: string;
	readonly sourceId?: string;
	readonly runId?: string;
	readonly workKey?: string;
}

export interface WakeRequest {
	readonly delayMs: number;
	readonly reason?: string;
	readonly workKey?: string;
	readonly attempt?: number;
}

export interface TickResult {
	readonly tickId: number;
	readonly selected: number;
	readonly started: number;
	readonly completions: number;
	readonly running: number;
	readonly diagnostics: readonly Diagnostic[];
}

export type PlotAgentEvent =
	| { readonly type: "tick_started"; readonly tickId: number }
	| { readonly type: "tick_completed"; readonly result: TickResult }
	| { readonly type: "source_observed"; readonly source: SourceRecord }
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
