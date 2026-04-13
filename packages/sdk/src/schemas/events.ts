export type AgentEventType =
	| "agent_start"
	| "agent_end"
	| "turn_start"
	| "turn_end"
	| "message_start"
	| "message_update"
	| "message_end"
	| "tool_execution_start"
	| "tool_execution_update"
	| "tool_execution_end"
	| "auto_compaction_start"
	| "auto_compaction_end"
	| "auto_retry_start"
	| "auto_retry_end"
	| "notification";

export interface AgentRuntimeEvent {
	readonly event: AgentEventType;
	readonly timestamp: string;
	readonly agentPid: string | null;
	readonly issueId: string;
	readonly issueIdentifier: string;
	readonly sessionId: string | null;
	readonly message: string | null;
	readonly usage?: {
		readonly inputTokens: number;
		readonly outputTokens: number;
		readonly totalTokens: number;
	};
	readonly toolCallId?: string;
	readonly toolName?: string;
	readonly isError?: boolean;
}
