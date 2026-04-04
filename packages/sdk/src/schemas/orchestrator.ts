import type { AgentRuntimeEvent } from "./events.js";

export type AgentPhase = "idle" | "thinking" | "tool_execution" | "compacting" | "retrying";

export interface ToolExecution {
	readonly toolCallId: string;
	readonly toolName: string;
}

export interface LiveSession {
	readonly sessionId: string;
	readonly threadId: string;
	readonly turnId: string;
	readonly agentPid: string | null;
	readonly lastEvent: string | null;
	readonly lastEventAt: string | null;
	readonly lastMessage: string | null;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly turnCount: number;
	readonly phase: AgentPhase;
	readonly activeTools: readonly ToolExecution[];
	readonly lastAssistantMessage: string | null;
}

export interface RunningEntry {
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly state: string;
	readonly startedAt: string;
	readonly workspacePath: string | null;
	readonly session: LiveSession;
}

export interface RetryEntry {
	readonly issueId: string;
	readonly identifier: string;
	readonly attempt: number;
	readonly dueAt: string;
	readonly error: string | null;
}

export interface TokenTotals {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens: number;
	readonly secondsRunning: number;
}

export interface RuntimeObservability {
	readonly commandQueueDepth: number;
	readonly commandQueuePeak: number;
	readonly commandQueuePressureCount: number;
	readonly staleRetryDropCount: number;
	readonly retriesScheduledByReason: {
		readonly continuation: number;
		readonly failure: number;
		readonly stall: number;
		readonly backpressure: number;
		readonly merge_conflict: number;
	};
	readonly workerStopsByReason: {
		readonly terminal: number;
		readonly inactive: number;
		readonly stalled: number;
	};
	readonly workerExitsByReason: {
		readonly success: number;
		readonly interrupted: number;
		readonly failure: number;
	};
}

export interface RuntimeSnapshot {
	readonly generatedAt: string;
	readonly running: readonly RunningEntry[];
	readonly retrying: readonly RetryEntry[];
	readonly codexTotals: TokenTotals;
	readonly observability: RuntimeObservability;
}

export interface IssueEventLog {
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly events: readonly AgentRuntimeEvent[];
}

export interface RefreshResult {
	readonly queued: boolean;
	readonly coalesced: boolean;
	readonly requestedAt: string;
	readonly operations: readonly string[];
}
