import type { OperatorAction, WorkStatus } from "./work-contract.js";

export type SessionState =
	| "starting"
	| "online"
	| "stopping"
	| "stopped"
	| "error";

export type SourceReadiness =
	| "checking"
	| "ready"
	| "action-required"
	| "unavailable";

export type ObservedWorkStatus = Exclude<WorkStatus, "cancelled">;

export type AgentRunStage =
	| "starting"
	| "working"
	| "verifying"
	| "finishing"
	| "failed";

export interface SourceActionInput {
	readonly sourceId: string;
	readonly requirementId: string;
	readonly actionId: string;
}

export type SourceActionStartResult =
	| { readonly accepted: false }
	| { readonly accepted: true; readonly actionRunId: string };

export interface SourceRequirementState {
	readonly id: string;
	readonly label: string;
	readonly status: SourceReadiness;
	readonly message?: string | undefined;
	readonly retryAfterMs?: number | undefined;
	readonly actions?: readonly OperatorAction[] | undefined;
}

export interface SourceState {
	readonly sourceId: string;
	readonly label: string;
	readonly readiness: SourceReadiness;
	readonly message?: string | undefined;
	readonly requirements: readonly SourceRequirementState[];
	readonly action?: SourceActionState | undefined;
}

export interface ObservedWorkItemState {
	readonly workKey: string;
	readonly sourceId: string;
	readonly title: string;
	readonly status: ObservedWorkStatus;
	readonly subject?: string | undefined;
	readonly subtitle?: string | undefined;
	readonly url?: string | undefined;
	readonly version?: string | undefined;
	readonly labels: readonly string[];
	readonly blockedReason?: string | undefined;
}

export interface AgentRunState {
	readonly workKey: string;
	readonly sourceId: string;
	readonly stage: AgentRunStage;
	readonly activity: string;
	readonly turnCount: number;
	readonly eventCount: number;
}

export interface DiagnosticMessage {
	readonly message: string;
}

export interface CompletedWorkState {
	readonly workKey: string;
	readonly label: string;
	readonly status: string;
	readonly message: string;
	readonly durationMs?: number | undefined;
	readonly url?: string | undefined;
}

export interface UsageTotals {
	readonly tokens: number;
	readonly cost?: number | undefined;
}

export interface SourceActionState {
	readonly actionRunId: string;
	readonly requirementId: string;
	readonly actionId: string;
	readonly status: "running" | "failed" | "cancelled";
	readonly progress?: string | undefined;
	readonly interaction?:
		| {
				readonly type: "open-url";
				readonly url: string;
				readonly fallbackText?: string | undefined;
		  }
		| undefined;
}
