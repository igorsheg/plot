import type {
	AgentRunOutcome,
	OperatorAction,
	OperatorObservationInput,
	WorkDisplay,
} from "@plot/sdk/work-contract";
import type {
	DiagnosticMessage,
	ObservedWorkStatus,
	SourceReadiness,
} from "@plot/sdk/runtime-contract";

export type {
	OperatorAction,
	OperatorActionConfirm,
	WorkDisplay,
} from "@plot/sdk/work-contract";

export interface OperatorObservation extends OperatorObservationInput {
	readonly actionLabel: string;
	readonly timestamp: string;
}

interface SourceRequirementIdentity {
	readonly id: string;
	readonly label: string;
}

export type SourceRequirementRecord =
	| (SourceRequirementIdentity & {
			readonly status: Extract<SourceReadiness, "checking" | "ready">;
	  })
	| (SourceRequirementIdentity & {
			readonly status: Extract<SourceReadiness, "action-required">;
			readonly message: string;
			readonly actions: readonly OperatorAction[];
	  })
	| (SourceRequirementIdentity & {
			readonly status: Extract<SourceReadiness, "unavailable">;
			readonly message: string;
			readonly retryAfterMs?: number | undefined;
	  });

export interface SourceRecord {
	readonly sourceId: string;
	readonly label: string;
	readonly readiness: SourceReadiness;
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
			readonly status: Extract<ObservedWorkStatus, "pending">;
			readonly operatorActions?: readonly OperatorAction[] | undefined;
	  })
	| (WorkIdentity & {
			readonly status: Extract<ObservedWorkStatus, "waiting">;
			readonly reason?: string | undefined;
			readonly operatorActions?: readonly OperatorAction[] | undefined;
	  })
	| (WorkIdentity & {
			readonly status: Extract<ObservedWorkStatus, "blocked">;
			readonly reason: string;
			readonly operatorActions: readonly OperatorAction[];
	  });

export type WorkRecord =
	| SourceWorkRecord
	| (WorkIdentity & {
			readonly status: Extract<ObservedWorkStatus, "running" | "draining">;
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

export interface WorkRun extends WorkIdentity {
	readonly runId: string;
}

export interface WorkResult {
	readonly output?: unknown;
}

type CompletionIdentity = Pick<
	WorkRun,
	"runId" | "sourceId" | "workKey" | "subject"
>;

export type Completion =
	| (CompletionIdentity & {
			readonly status: Extract<AgentRunOutcome, "succeeded">;
			readonly output?: unknown;
	  })
	| (CompletionIdentity & {
			readonly status: Extract<AgentRunOutcome, "failed">;
			readonly error: string;
	  })
	| (CompletionIdentity & {
			readonly status: Extract<AgentRunOutcome, "interrupted">;
			readonly reason: string;
	  })
	| (CompletionIdentity & {
			readonly status: Extract<AgentRunOutcome, "timed_out">;
			readonly reason: string;
	  });

export interface Diagnostic extends DiagnosticMessage {
	readonly level: "info" | "warning" | "error";
	readonly phase: "reconcile" | "act";
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

export type AgentEvent =
	| { readonly type: "tick_started"; readonly tickId: number }
	| { readonly type: "tick_completed"; readonly result: TickResult }
	| { readonly type: "source_observed"; readonly source: SourceRecord }
	| { readonly type: "work_observed"; readonly work: WorkRecord }
	| { readonly type: "work_removed"; readonly workKey: string }
	| ({ readonly type: "wake_scheduled" } & WakeRequest)
	| { readonly type: "attempt_started"; readonly run: WorkRun }
	| { readonly type: "attempt_completed"; readonly completion: Completion };
