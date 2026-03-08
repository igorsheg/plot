import { useState } from "react";
import { DateTime } from "effect";
import type { AgentEventType, AgentRuntimeEvent } from "@plot/sdk";
import { useTraceViewer } from "./root";

function formatFull(dt: DateTime.Utc): string {
  return new Date(Number(DateTime.toEpochMillis(dt))).toISOString();
}

const borderColorMap: Record<string, string> = {
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

function eventBorderColor(type: AgentEventType): string {
  return borderColorMap[type] ?? "border-l-zinc-700";
}

interface TreeField {
  key: string;
  value: string;
  valueClass: string;
}

function collectFields(event: AgentRuntimeEvent): TreeField[] {
  const fields: TreeField[] = [];

  if (event.message) {
    fields.push({
      key: "message",
      value: event.message,
      valueClass: "text-foreground",
    });
  }
  if (event.toolName) {
    fields.push({
      key: "toolName",
      value: event.toolName,
      valueClass: "text-foreground",
    });
  }
  if (event.toolCallId) {
    fields.push({
      key: "toolCallId",
      value: event.toolCallId,
      valueClass: "text-foreground",
    });
  }
  if (event.isError !== undefined) {
    fields.push({
      key: "isError",
      value: String(event.isError),
      valueClass: event.isError ? "text-red-400" : "text-foreground",
    });
  }
  if (event.usage) {
    fields.push({
      key: "usage.inputTokens",
      value: String(event.usage.inputTokens),
      valueClass: "text-emerald-400",
    });
    fields.push({
      key: "usage.outputTokens",
      value: String(event.usage.outputTokens),
      valueClass: "text-emerald-400",
    });
    fields.push({
      key: "usage.totalTokens",
      value: String(event.usage.totalTokens),
      valueClass: "text-emerald-400",
    });
  }

  return fields;
}

export function DetailPane() {
  const { state } = useTraceViewer();
  const [showRaw, setShowRaw] = useState(false);

  if (!state.selectedEvent) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <span className="type-meta">select an event to inspect</span>
      </div>
    );
  }
  const event = state.selectedEvent;

  const fields = collectFields(event);

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="type-body tabular-nums">
          <span className="text-foreground">{event.event}</span>
          <span className="text-muted-foreground"> · </span>
          <span className="text-muted-foreground">{formatFull(event.timestamp)}</span>
        </span>
        <button
          type="button"
          className="type-meta hover:text-foreground"
          onClick={() => setShowRaw((v) => !v)}
          aria-label="toggle raw json"
        >
          {"{}"}
        </button>
      </div>
      <div className={`overflow-y-auto border-l-2 p-3 type-body ${eventBorderColor(event.event)}`}>
        <div>
          {fields.map((field, i) => {
            const isLast = i === fields.length - 1;
            const branch = isLast ? "└─" : "├─";
            return (
              <div key={field.key} className="whitespace-pre-wrap">
                <span className="text-muted-foreground">{branch} </span>
                <span className="text-sky-400">{field.key}</span>
                <span className="text-muted-foreground">: </span>
                <span className={field.valueClass}>{field.value}</span>
              </div>
            );
          })}
        </div>
        {showRaw && (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap type-meta">
            {JSON.stringify(event, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
