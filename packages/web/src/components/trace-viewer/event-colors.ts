import type { AgentEventType } from "@plot/sdk";

export const eventColorMap: Record<string, string> = {
	agent_start: "border-l-zinc-500",
	agent_end: "border-l-zinc-500",
	turn_start: "border-l-sky-400",
	turn_end: "border-l-sky-400",
	message_start: "border-l-violet-400",
	message_update: "border-l-violet-400",
	message_end: "border-l-violet-400",
	tool_execution_start: "border-l-emerald-400",
	tool_execution_update: "border-l-emerald-400",
	tool_execution_end: "border-l-emerald-400",
	auto_compaction_start: "border-l-amber-400",
	auto_compaction_end: "border-l-amber-400",
	auto_retry_start: "border-l-red-400",
	auto_retry_end: "border-l-red-400",
	notification: "border-l-zinc-600",
};

export function eventBorderColor(type: AgentEventType): string {
	return eventColorMap[type] ?? "border-l-zinc-600";
}
