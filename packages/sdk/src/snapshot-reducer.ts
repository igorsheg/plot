import {
  LiveSession,
  RunningEntry,
  RuntimeSnapshot,
  ToolExecution,
} from "./schemas/orchestrator.js";
import type { AgentRuntimeEvent } from "./schemas/events.js";

export type ApplyResult =
  | { readonly type: "patched"; readonly snapshot: RuntimeSnapshot }
  | { readonly type: "resync" };

export function applyRuntimeEvent(
  snapshot: RuntimeSnapshot | null,
  event: AgentRuntimeEvent,
): ApplyResult {
  if (!snapshot) return { type: "resync" };

  const idx = snapshot.running.findIndex((r) => r.issueId === event.issueId);
  if (idx === -1) return { type: "resync" };

  if (event.event === "agent_end") return { type: "resync" };

  const entry = snapshot.running[idx]!;
  const session = entry.session;

  let lastMessage = session.lastMessage;
  if (event.message && event.event !== "notification") {
    lastMessage = event.message;
  } else if (event.event === "notification" && event.message) {
    lastMessage = ((lastMessage ?? "") + event.message).slice(-200);
  }

  const shouldIncrementTurn = event.event === "turn_end";

  let phase = session.phase;
  let activeTools = session.activeTools;
  let lastAssistantMessage = session.lastAssistantMessage;

  switch (event.event) {
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
        activeTools = [
          ...activeTools,
          new ToolExecution({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
          }),
        ];
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

  const newSession = new LiveSession({
    sessionId: session.sessionId,
    threadId: session.threadId,
    turnId: session.turnId,
    agentPid: session.agentPid,
    lastEvent: event.event,
    lastEventAt: event.timestamp,
    lastMessage,
    inputTokens: event.usage?.inputTokens ?? session.inputTokens,
    outputTokens: event.usage?.outputTokens ?? session.outputTokens,
    totalTokens: event.usage?.totalTokens ?? session.totalTokens,
    turnCount: shouldIncrementTurn ? session.turnCount + 1 : session.turnCount,
    phase,
    activeTools,
    lastAssistantMessage,
  });

  const newEntry = new RunningEntry({
    issueId: entry.issueId,
    issueIdentifier: entry.issueIdentifier,
    state: entry.state,
    startedAt: entry.startedAt,
    workspacePath: entry.workspacePath,
    session: newSession,
  });

  const newRunning = [...snapshot.running];
  newRunning[idx] = newEntry;

  return {
    type: "patched",
    snapshot: new RuntimeSnapshot({
      generatedAt: snapshot.generatedAt,
      counts: snapshot.counts,
      running: newRunning,
      retrying: snapshot.retrying,
      codexTotals: snapshot.codexTotals,
      observability: snapshot.observability,
      rateLimits: snapshot.rateLimits,
    }),
  };
}
