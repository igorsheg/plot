import { Effect, DateTime, Stream } from "effect";
import {
  IssueDetail,
  IssueEventLog,
  IssueNotFound,
  LiveSession,
  OrchestratorUnavailable,
  RefreshResult,
  RetryEntry,
  RunningEntry,
  RuntimeObservability,
  ToolExecution,
  RuntimeSnapshot,
  TokenTotals,
} from "@plot/sdk";
import { Orchestrator } from "./core/index.js";

const parseSessionId = (sid: string | null) => {
  if (!sid) return { threadId: "", turnId: "" };
  const idx = sid.lastIndexOf("-");
  if (idx === -1) return { threadId: sid, turnId: "" };
  return { threadId: sid.slice(0, idx), turnId: sid.slice(idx + 1) };
};

const mapRunningEntry = (r: {
  issueId: string;
  issueIdentifier: string;
  state: string;
  startedAt: number;
  workspacePath: string;
  sessionId: string | null;
  lastEventAt: number;
  lastMessage: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  turnCount: number;
  phase?: "idle" | "thinking" | "tool_execution" | "compacting" | "retrying";
  activeTools?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
  lastAssistantMessage?: string | null;
}) => {
  const { threadId, turnId } = parseSessionId(r.sessionId);
  return new RunningEntry({
    issueId: r.issueId,
    issueIdentifier: r.issueIdentifier,
    state: r.state,
    startedAt: DateTime.unsafeFromDate(new Date(r.startedAt)),
    workspacePath: r.workspacePath,
    session: new LiveSession({
      sessionId: r.sessionId ?? "",
      threadId,
      turnId,
      agentPid: null,
      lastEvent: null,
      lastEventAt: r.lastEventAt ? DateTime.unsafeFromDate(new Date(r.lastEventAt)) : null,
      lastMessage: r.lastMessage,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      totalTokens: r.totalTokens,
      turnCount: r.turnCount,
      phase: r.phase ?? "idle",
      activeTools: (r.activeTools ?? []).map((t) => new ToolExecution(t)),
      lastAssistantMessage: r.lastAssistantMessage ?? null,
    }),
  });
};

const mapRetryEntry = (r: {
  issueId: string;
  identifier: string;
  attempt: number;
  dueAtMs: number;
  error: string | null;
}) =>
  new RetryEntry({
    issueId: r.issueId,
    identifier: r.identifier,
    attempt: r.attempt,
    dueAt: DateTime.unsafeFromDate(new Date(r.dueAtMs)),
    error: r.error,
  });

const mapRuntimeSnapshot = (state: {
  running: Map<string, Parameters<typeof mapRunningEntry>[0]>;
  retryAttempts: Map<string, Parameters<typeof mapRetryEntry>[0]>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  endedSessionSeconds: number;
  commandQueueDepth: number;
  commandQueuePeak: number;
  commandQueuePressureCount: number;
  staleRetryDropCount: number;
  retriesScheduledByReason: {
    continuation: number;
    failure: number;
    backpressure: number;
  };
  workerStopsByReason: {
    terminal: number;
    inactive: number;
    stalled: number;
  };
  workerExitsByReason: {
    success: number;
    interrupted: number;
    failure: number;
  };
}) => {
  const running = [...state.running.values()].map(mapRunningEntry);
  const retrying = [...state.retryAttempts.values()].map(mapRetryEntry);
  const now = Date.now();
  const activeSeconds = [...state.running.values()].reduce(
    (acc, r) => acc + (now - r.startedAt) / 1000,
    0,
  );

  return new RuntimeSnapshot({
    generatedAt: DateTime.unsafeNow(),
    counts: { running: running.length, retrying: retrying.length },
    running,
    retrying,
    codexTotals: new TokenTotals({
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
      totalTokens: state.totalTokens,
      secondsRunning: state.endedSessionSeconds + activeSeconds,
    }),
    observability: new RuntimeObservability({
      commandQueueDepth: state.commandQueueDepth,
      commandQueuePeak: state.commandQueuePeak,
      commandQueuePressureCount: state.commandQueuePressureCount,
      staleRetryDropCount: state.staleRetryDropCount,
      retriesScheduledByReason: state.retriesScheduledByReason,
      workerStopsByReason: state.workerStopsByReason,
      workerExitsByReason: state.workerExitsByReason,
    }),
    rateLimits: null,
  });
};

export const makeObservabilityApi = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator;
  const stateStream = orchestrator.stateStream.pipe(Stream.map(mapRuntimeSnapshot));

  const getState = orchestrator.getState.pipe(
    Effect.map(mapRuntimeSnapshot),
    Effect.mapError(
      () =>
        new OrchestratorUnavailable({
          message: "Orchestrator state is unavailable",
        }),
    ),
  );

  const getIssue = (identifier: string) =>
    Effect.gen(function* () {
      const state = yield* orchestrator.getState.pipe(
        Effect.mapError(
          () =>
            new OrchestratorUnavailable({
              message: "Orchestrator state is unavailable",
            }),
        ),
      );
      const running = [...state.running.values()].find((r) => r.issueIdentifier === identifier);
      const retry = [...state.retryAttempts.values()].find((r) => r.identifier === identifier);

      if (!running && !retry) {
        return yield* Effect.fail(
          new IssueNotFound({
            identifier,
            message: `Issue not found: ${identifier}`,
          }),
        );
      }

      return new IssueDetail({
        issueIdentifier: identifier,
        issueId: running?.issueId ?? retry?.issueId ?? "",
        status: running ? "running" : "retrying",
        workspacePath: running?.workspacePath ?? null,
        running: running ? mapRunningEntry(running) : null,
        retry: retry ? mapRetryEntry(retry) : null,
        lastError: retry?.error ?? null,
        eventTail: running?.eventTail ?? [],
      });
    });

  const getEventLog = (identifier: string) =>
    Effect.gen(function* () {
      const state = yield* orchestrator.getState.pipe(
        Effect.mapError(
          () =>
            new OrchestratorUnavailable({
              message: "Orchestrator state is unavailable",
            }),
        ),
      );
      const log = [...state.eventLogs.values()].find((l) => l.issueIdentifier === identifier);
      if (!log) {
        return yield* Effect.fail(
          new IssueNotFound({
            identifier,
            message: `Event log not found: ${identifier}`,
          }),
        );
      }
      return new IssueEventLog({
        issueId: log.issueId,
        issueIdentifier: log.issueIdentifier,
        events: [...log.events],
      });
    });

  const triggerRefresh = Effect.gen(function* () {
    yield* orchestrator.tick.pipe(
      Effect.mapError(
        () =>
          new OrchestratorUnavailable({
            message: "Orchestrator is unavailable",
          }),
      ),
    );
    return new RefreshResult({
      queued: true,
      coalesced: false,
      requestedAt: DateTime.unsafeNow(),
      operations: ["poll", "reconcile"],
    });
  });

  return {
    getState,
    getIssue,
    getEventLog,
    triggerRefresh,
    eventStream: orchestrator.eventStream,
    stateStream,
  };
});

export class ObservabilityApi extends Effect.Service<ObservabilityApi>()("ObservabilityApi", {
  effect: makeObservabilityApi,
  dependencies: [Orchestrator.Default],
}) {}
