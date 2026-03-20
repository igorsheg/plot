import { useCallback } from "react";
import type { AgentRuntimeEvent, AgentEventType } from "@plot/sdk";
import { cn } from "@/lib/utils";
import { formatTimestamp } from "@/lib/format";
import { eventBorderColor } from "./event-colors";
import { useTraceViewer } from "./root";

const shortLabelMap: Record<string, string> = {
	agent_start: "agent▸",
	agent_end: "agent◂",
	turn_start: "turn▸",
	turn_end: "turn◂",
	message_start: "msg▸",
	message_update: "msg",
	message_end: "msg◂",
	tool_execution_start: "tool▸",
	tool_execution_update: "tool",
	tool_execution_end: "tool◂",
	auto_compaction_start: "compact▸",
	auto_compaction_end: "compact◂",
	auto_retry_start: "retry▸",
	auto_retry_end: "retry◂",
	notification: "··",
};

function shortLabel(type: AgentEventType): string {
	return shortLabelMap[type] ?? type;
}

function eventSummary(event: AgentRuntimeEvent): string {
	if (event.toolName) return event.toolName;
	if (event.message) {
		return event.message.length > 120 ? event.message.slice(0, 120) + "…" : event.message;
	}
	return "";
}

interface EventRowProps {
	event: AgentRuntimeEvent;
}

export function EventRow({ event }: EventRowProps) {
	const { state, actions } = useTraceViewer();
	const isSelected = state.selectedEvent === event;

	const handleClick = useCallback(() => {
		actions.selectEvent(isSelected ? null : event);
	}, [actions, event, isSelected]);

	if (event.event === "message_start" && !event.message && !event.toolName) {
		return null;
	}

	const summary = eventSummary(event);
	const tokenSuffix =
		event.event === "turn_end" && event.usage
			? ` ${event.usage.totalTokens.toLocaleString()} tok`
			: "";

	return (
		<button
			type="button"
			className={cn(
				"trace-row",
				eventBorderColor(event.event),
				isSelected && "trace-row-selected",
				event.isError && "trace-row-error",
			)}
			onClick={handleClick}
		>
			<span className="type-meta shrink-0 tabular-nums">{formatTimestamp(event.timestamp)}</span>
			<span className="w-[72px] shrink-0 truncate text-muted-foreground">
				{shortLabel(event.event)}
			</span>
			{summary && <span className="min-w-0 flex-1 truncate text-foreground">{summary}</span>}
			{tokenSuffix && <span className="type-meta shrink-0">{tokenSuffix}</span>}
		</button>
	);
}
