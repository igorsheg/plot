import {
  LiveSession,
  RunningEntry,
  RuntimeSnapshot,
  ToolExecution,
} from "./schemas/orchestrator.js";
import type { AgentRuntimeEvent } from "./schemas/events.js";
import { reducePhase } from "./phase-reducer.js";

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

  const next = reducePhase(
    { phase: session.phase, activeTools: session.activeTools, lastAssistantMessage: session.lastAssistantMessage },
    event.event,
    event,
  );

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
    phase: next.phase,
    activeTools: next.activeTools.map((t) => new ToolExecution(t)),
    lastAssistantMessage: next.lastAssistantMessage,
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
