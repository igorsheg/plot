import type { AgentEventType } from "./schemas/events.js";
import type { AgentPhase } from "./schemas/orchestrator.js";

export interface ToolHandle {
	readonly toolCallId: string;
	readonly toolName: string;
}

export interface PhaseState {
	readonly phase: AgentPhase;
	readonly activeTools: ReadonlyArray<ToolHandle>;
	readonly lastAssistantMessage: string | null;
}

export function reducePhase(
	state: PhaseState,
	eventType: AgentEventType,
	event: {
		readonly message?: string | null;
		readonly toolCallId?: string;
		readonly toolName?: string;
	},
): PhaseState {
	let { phase, activeTools, lastAssistantMessage } = state;

	switch (eventType) {
		case "message_start":
		case "message_update":
			phase = "thinking";
			break;
		case "message_end":
			if (event.message) lastAssistantMessage = event.message;
			phase = "idle";
			break;
		case "tool_execution_start":
			if (event.toolCallId && event.toolName) {
				activeTools = [...activeTools, { toolCallId: event.toolCallId, toolName: event.toolName }];
			}
			phase = "tool_execution";
			break;
		case "tool_execution_end":
			if (event.toolCallId) {
				activeTools = activeTools.filter((t) => t.toolCallId !== event.toolCallId);
			}
			phase = activeTools.length > 0 ? "tool_execution" : "idle";
			break;
		case "turn_start":
			phase = "thinking";
			break;
		case "turn_end":
			phase = "idle";
			activeTools = [];
			break;
		case "auto_compaction_start":
			phase = "compacting";
			break;
		case "auto_compaction_end":
			phase = "idle";
			break;
		case "auto_retry_start":
			phase = "retrying";
			break;
		case "auto_retry_end":
			phase = "idle";
			break;
	}

	return { phase, activeTools, lastAssistantMessage };
}
