import { DateTime, Fiber } from "effect";
import { AgentRuntimeEvent } from "@plot/sdk";
import type { Issue } from "../../schemas/issue.js";
import type { ResolvedConfig } from "../config-service.js";

export interface RunningEntry {
  readonly issueId: string;
  readonly issueIdentifier: string;
  readonly issue: Issue;
  readonly state: string;
  readonly startedAt: number;
  readonly fiber: Fiber.RuntimeFiber<void, unknown> | null;
  readonly turnCount: number;
  readonly lastEventAt: number;
  readonly sessionId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly workspacePath: string;
  readonly lastMessage: string | null;
  readonly eventTail: ReadonlyArray<AgentRuntimeEvent>;
  readonly phase: "idle" | "thinking" | "tool_execution" | "compacting" | "retrying";
  readonly activeTools: ReadonlyArray<{ toolCallId: string; toolName: string }>;
  readonly lastAssistantMessage: string | null;
}

export type RetryReason = "continuation" | "failure" | "backpressure";

export interface RetryEntry {
  readonly issueId: string;
  readonly identifier: string;
  readonly attempt: number;
  readonly dueAtMs: number;
  readonly error: string | null;
  readonly reason: RetryReason;
}

export interface IssueEventLogEntry {
  readonly issueId: string;
  readonly issueIdentifier: string;
  readonly events: ReadonlyArray<AgentRuntimeEvent>;
}

export interface OrchestratorState {
  readonly running: Map<string, RunningEntry>;
  readonly claimed: Set<string>;
  readonly retryAttempts: Map<string, RetryEntry>;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly endedSessionSeconds: number;
  readonly commandQueueDepth: number;
  readonly commandQueuePeak: number;
  readonly commandQueuePressureCount: number;
  readonly staleRetryDropCount: number;
  readonly retriesScheduledByReason: Record<RetryReason, number>;
  readonly workerStopsByReason: Record<"terminal" | "inactive" | "stalled", number>;
  readonly workerExitsByReason: Record<"success" | "interrupted" | "failure", number>;
  readonly eventLogs: Map<string, IssueEventLogEntry>;
}

export const initialState: OrchestratorState = {
  running: new Map(),
  claimed: new Set(),
  retryAttempts: new Map(),
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  endedSessionSeconds: 0,
  commandQueueDepth: 0,
  commandQueuePeak: 0,
  commandQueuePressureCount: 0,
  staleRetryDropCount: 0,
  retriesScheduledByReason: {
    continuation: 0,
    failure: 0,
    backpressure: 0,
  },
  workerStopsByReason: {
    terminal: 0,
    inactive: 0,
    stalled: 0,
  },
  workerExitsByReason: {
    success: 0,
    interrupted: 0,
    failure: 0,
  },
  eventLogs: new Map(),
};

export const normalizeState = (s: string) => s.trim().toLowerCase();

export const isDispatchable = (state: string, config: ResolvedConfig) =>
  config.dispatchStates.some(
    (dispatchState) => normalizeState(dispatchState) === normalizeState(state),
  );

export const isParked = (state: string, config: ResolvedConfig) =>
  config.parkedStates.some((parkedState) => normalizeState(parkedState) === normalizeState(state));

export const isTerminal = (state: string, config: ResolvedConfig) =>
  config.terminalStates.some((t) => normalizeState(t) === normalizeState(state));

export const availableSlots = (state: OrchestratorState, config: ResolvedConfig): number =>
  Math.max(config.maxConcurrentAgents - state.running.size, 0);

export const perStateSlots = (
  issueState: string,
  state: OrchestratorState,
  config: ResolvedConfig,
): number => {
  const limit = config.maxConcurrentAgentsByState.get(normalizeState(issueState));
  if (limit === undefined) return availableSlots(state, config);
  const current = [...state.running.values()].filter(
    (r) => normalizeState(r.state) === normalizeState(issueState),
  ).length;
  return Math.max(limit - current, 0);
};

export const hasNonTerminalBlockers = (issue: Issue, config: ResolvedConfig): boolean =>
  issue.blockedBy.some((b) => b.state !== null && !isTerminal(b.state, config));

export const isEligible = (
  issue: Issue,
  state: OrchestratorState,
  config: ResolvedConfig,
): boolean => {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
  if (!isDispatchable(issue.state, config)) return false;
  if (isTerminal(issue.state, config)) return false;
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;
  if (availableSlots(state, config) <= 0) return false;
  if (perStateSlots(issue.state, state, config) <= 0) return false;
  if (normalizeState(issue.state) === "todo" && hasNonTerminalBlockers(issue, config)) {
    return false;
  }
  return true;
};

export const sortCandidates = (issues: ReadonlyArray<Issue>): ReadonlyArray<Issue> =>
  [...issues].sort((a, b) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const ca = a.createdAt ? Number(DateTime.toEpochMillis(a.createdAt)) : Infinity;
    const cb = b.createdAt ? Number(DateTime.toEpochMillis(b.createdAt)) : Infinity;
    if (ca !== cb) return ca - cb;
    return a.identifier.localeCompare(b.identifier);
  });

export const createRunningEntry = (
  issue: Issue,
  workspacePath: string,
  startedAt: number,
): RunningEntry => ({
  issueId: issue.id,
  issueIdentifier: issue.identifier,
  issue,
  state: issue.state,
  startedAt,
  fiber: null,
  turnCount: 0,
  lastEventAt: startedAt,
  sessionId: null,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  workspacePath,
  lastMessage: null,
  eventTail: [],
  phase: "idle",
  activeTools: [],
  lastAssistantMessage: null,
});

export const consumeRuntimeEvent = (
  state: OrchestratorState,
  event: AgentRuntimeEvent,
): OrchestratorState => {
  const entry = state.running.get(event.issueId);
  if (!entry) return appendToEventLog(state, event);

  const running = new Map(state.running);
  let { sessionId, turnCount, inputTokens, outputTokens, totalTokens } = entry;

  if (event.sessionId) sessionId = event.sessionId;
  if (event.event === "turn_end") turnCount += 1;

  let deltaInput = 0;
  let deltaOutput = 0;
  let deltaTotal = 0;
  if (event.usage) {
    deltaInput = event.usage.inputTokens - inputTokens;
    deltaOutput = event.usage.outputTokens - outputTokens;
    deltaTotal = event.usage.totalTokens - totalTokens;
    inputTokens = event.usage.inputTokens;
    outputTokens = event.usage.outputTokens;
    totalTokens = event.usage.totalTokens;
  }

  let lastMessage = entry.lastMessage;
  if (event.message && event.event !== "notification") {
    lastMessage = event.message;
  } else if (event.event === "notification" && event.message) {
    const current = lastMessage ?? "";
    lastMessage = (current + event.message).slice(-200);
  }

  const maxEventTail = 200;
  const eventTail =
    entry.eventTail.length >= maxEventTail
      ? [...entry.eventTail.slice(-(maxEventTail - 1)), event]
      : [...entry.eventTail, event];

  let phase = entry.phase;
  let activeTools = entry.activeTools;
  let lastAssistantMessage = entry.lastAssistantMessage;

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

  running.set(event.issueId, {
    ...entry,
    lastEventAt: Date.now(),
    sessionId,
    turnCount,
    inputTokens,
    outputTokens,
    totalTokens,
    lastMessage,
    eventTail,
    phase,
    activeTools,
    lastAssistantMessage,
  });

  return appendToEventLog(
    {
      ...state,
      running,
      totalInputTokens: state.totalInputTokens + Math.max(deltaInput, 0),
      totalOutputTokens: state.totalOutputTokens + Math.max(deltaOutput, 0),
      totalTokens: state.totalTokens + Math.max(deltaTotal, 0),
    },
    event,
  );
};

export const releaseClaimFromState = (
  state: OrchestratorState,
  issueId: string,
): OrchestratorState => {
  const claimed = new Set(state.claimed);
  claimed.delete(issueId);
  return { ...state, claimed };
};

export const clearRetryAttemptFromState = (
  state: OrchestratorState,
  issueId: string,
): OrchestratorState => {
  if (!state.retryAttempts.has(issueId)) return state;
  const retryAttempts = new Map(state.retryAttempts);
  retryAttempts.delete(issueId);
  return { ...state, retryAttempts };
};

export const removeRunningEntryFromState = (
  state: OrchestratorState,
  issueId: string,
  now: number,
): OrchestratorState => {
  const entry = state.running.get(issueId);
  if (!entry) return state;
  const running = new Map(state.running);
  running.delete(issueId);
  const elapsed = (now - entry.startedAt) / 1000;
  return {
    ...state,
    running,
    endedSessionSeconds: state.endedSessionSeconds + elapsed,
  };
};

export const noteCommandQueueSizeInState = (
  state: OrchestratorState,
  queueSize: number,
): OrchestratorState => ({
  ...state,
  commandQueueDepth: queueSize,
  commandQueuePeak: Math.max(state.commandQueuePeak, queueSize),
});

export const incrementCommandQueuePressureInState = (
  state: OrchestratorState,
  queueSize: number,
): OrchestratorState => ({
  ...state,
  commandQueueDepth: queueSize,
  commandQueuePressureCount: state.commandQueuePressureCount + 1,
  commandQueuePeak: Math.max(state.commandQueuePeak, queueSize),
});

export const incrementStaleRetryDropCount = (state: OrchestratorState): OrchestratorState => ({
  ...state,
  staleRetryDropCount: state.staleRetryDropCount + 1,
});

const MAX_EVENT_LOG_SIZE = 2000;

const coalesceNotification = (
  prev: ReadonlyArray<AgentRuntimeEvent>,
  event: AgentRuntimeEvent,
): ReadonlyArray<AgentRuntimeEvent> | null => {
  if (event.event !== "notification" || prev.length === 0) return null;
  const last = prev[prev.length - 1]!;
  if (last.event !== "notification" || last.issueId !== event.issueId) return null;
  const merged = new AgentRuntimeEvent({
    ...last,
    timestamp: event.timestamp,
    message: (last.message ?? "") + (event.message ?? ""),
  });
  const next = prev.slice(0, -1);
  return [...next, merged];
};

export const appendToEventLog = (
  state: OrchestratorState,
  event: AgentRuntimeEvent,
): OrchestratorState => {
  const logs = new Map(state.eventLogs);
  const existing = logs.get(event.issueId);
  const prev = existing?.events ?? [];
  const coalesced = coalesceNotification(prev, event);
  const events = coalesced
    ? coalesced
    : prev.length >= MAX_EVENT_LOG_SIZE
      ? [...prev.slice(-(MAX_EVENT_LOG_SIZE - 1)), event]
      : [...prev, event];
  logs.set(event.issueId, {
    issueId: event.issueId,
    issueIdentifier: event.issueIdentifier,
    events,
  });
  return { ...state, eventLogs: logs };
};

export const clearEventLog = (state: OrchestratorState, issueId: string): OrchestratorState => {
  if (!state.eventLogs.has(issueId)) return state;
  const logs = new Map(state.eventLogs);
  logs.delete(issueId);
  return { ...state, eventLogs: logs };
};
