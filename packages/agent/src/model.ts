import type { OperatorAction, WorkDisplay } from "@plot/sdk/work-contract";

export type {
	OperatorAction,
	OperatorActionConfirm,
	WorkDisplay,
} from "@plot/sdk/work-contract";

export interface OperatorObservation {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly timestamp: string;
	readonly comment?: string;
	readonly clientId?: string;
	readonly actor?: unknown;
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
			readonly retryAfterMs?: number | undefined;
	  };

export interface SourceRecord {
	readonly sourceId: string;
	readonly label: string;
	readonly readiness: SourceRequirementRecord["status"];
	readonly message?: string | undefined;
	readonly requirements: readonly SourceRequirementRecord[];
}

interface WorkIdentity {
	readonly workKey: string;
	readonly sourceId: string;
	readonly subject?: string | undefined;
	readonly display?: WorkDisplay | undefined;
}

export type SourceWorkRecord =
	| (WorkIdentity & {
			readonly status: "pending";
			readonly operatorActions?: readonly OperatorAction[] | undefined;
	  })
	| (WorkIdentity & {
			readonly status: "waiting";
			readonly reason?: string | undefined;
			readonly operatorActions?: readonly OperatorAction[] | undefined;
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
			readonly operatorActions?: readonly OperatorAction[] | undefined;
	  });

export interface WorkItem {
	readonly workKey: string;
	readonly subject?: string | undefined;
	readonly templateContext?: unknown;
	/** Source-owned data retained with the selected item for lifecycle hooks. */
	readonly sourceData?: unknown;
	readonly display?: WorkDisplay | undefined;
	readonly operatorActions?: readonly OperatorAction[] | undefined;
}

export interface WorkRun {
	readonly runId: string;
	readonly sourceId: string;
	readonly workKey: string;
	readonly subject?: string | undefined;
	readonly display?: WorkDisplay | undefined;
}

export interface WorkResult {
	readonly output?: unknown;
}

interface CompletionIdentity {
	readonly runId: string;
	readonly sourceId: string;
	readonly workKey: string;
	readonly subject?: string | undefined;
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
	readonly phase: "reconcile" | "act";
	readonly message: string;
	readonly sourceId?: string;
	readonly runId?: string;
	readonly workKey?: string;
}

export interface WakeRequest {
	readonly delayMs: number;
	readonly reason?: string | undefined;
	readonly workKey?: string | undefined;
	readonly attempt?: number | undefined;
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
			readonly reason?: string | undefined;
			readonly workKey?: string | undefined;
			readonly attempt?: number | undefined;
	  }
	| { readonly type: "attempt_started"; readonly run: WorkRun }
	| { readonly type: "attempt_completed"; readonly completion: Completion };
