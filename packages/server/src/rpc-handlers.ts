import { Effect, DateTime } from "effect";
import {
  PlotRpcs,
  RefreshResult,
  RuntimeSnapshot,
  IssueDetail,
  RunningEntry,
  RetryEntry,
  LiveSession,
  TokenTotals,
} from "@plot/shared";
import { Orchestrator } from "@plot/core";

export const RpcHandlersLive = PlotRpcs.toLayer(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator;

    return {
      GetState: () =>
        Effect.gen(function* () {
          const state = yield* orchestrator.getState;

          const parseSessionId = (sid: string | null) => {
            if (!sid) return { threadId: "", turnId: "" };
            const idx = sid.lastIndexOf("-");
            if (idx === -1) return { threadId: sid, turnId: "" };
            return { threadId: sid.slice(0, idx), turnId: sid.slice(idx + 1) };
          };

          const running = [...state.running.values()].map((r) => {
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
                lastEventAt: r.lastEventAt
                  ? DateTime.unsafeFromDate(new Date(r.lastEventAt))
                  : null,
                lastMessage: r.lastMessage,
                inputTokens: r.inputTokens,
                outputTokens: r.outputTokens,
                totalTokens: r.totalTokens,
                turnCount: r.turnCount,
              }),
            });
          });

          const retrying = [...state.retryAttempts.values()].map(
            (r) =>
              new RetryEntry({
                issueId: r.issueId,
                identifier: r.identifier,
                attempt: r.attempt,
                dueAt: DateTime.unsafeFromDate(new Date(r.dueAtMs)),
                error: r.error,
              }),
          );

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
            rateLimits: null,
          });
        }),

      GetIssue: ({ identifier }) =>
        Effect.gen(function* () {
          const state = yield* orchestrator.getState;
          const running = [...state.running.values()].find((r) => r.issueIdentifier === identifier);
          const retry = [...state.retryAttempts.values()].find((r) => r.identifier === identifier);

          if (!running && !retry) {
            return yield* Effect.fail(`Issue not found: ${identifier}`);
          }

          const parseSessionId = (sid: string | null) => {
            if (!sid) return { threadId: "", turnId: "" };
            const idx = sid.lastIndexOf("-");
            if (idx === -1) return { threadId: sid, turnId: "" };
            return { threadId: sid.slice(0, idx), turnId: sid.slice(idx + 1) };
          };

          return new IssueDetail({
            issueIdentifier: identifier,
            issueId: running?.issueId ?? retry?.issueId ?? "",
            status: running ? "running" : retry ? "retrying" : "unknown",
            workspacePath: running?.workspacePath ?? null,
            running: running
              ? (() => {
                  const { threadId, turnId } = parseSessionId(running.sessionId);
                  return new RunningEntry({
                    issueId: running.issueId,
                    issueIdentifier: running.issueIdentifier,
                    state: running.state,
                    startedAt: DateTime.unsafeFromDate(new Date(running.startedAt)),
                    workspacePath: running.workspacePath,
                    session: new LiveSession({
                      sessionId: running.sessionId ?? "",
                      threadId,
                      turnId,
                      agentPid: null,
                      lastEvent: null,
                      lastEventAt: running.lastEventAt
                        ? DateTime.unsafeFromDate(new Date(running.lastEventAt))
                        : null,
                      lastMessage: running.lastMessage,
                      inputTokens: running.inputTokens,
                      outputTokens: running.outputTokens,
                      totalTokens: running.totalTokens,
                      turnCount: running.turnCount,
                    }),
                  });
                })()
              : null,
            retry: retry
              ? new RetryEntry({
                  issueId: retry.issueId,
                  identifier: retry.identifier,
                  attempt: retry.attempt,
                  dueAt: DateTime.unsafeFromDate(new Date(retry.dueAtMs)),
                  error: retry.error,
                })
              : null,
            lastError: retry?.error ?? null,
            eventTail: running?.eventTail ?? [],
          });
        }),

      TriggerRefresh: () =>
        Effect.gen(function* () {
          yield* orchestrator.tick;
          return new RefreshResult({
            queued: true,
            coalesced: false,
            requestedAt: DateTime.unsafeNow(),
            operations: ["poll", "reconcile"],
          });
        }),

      StreamEvents: () => orchestrator.eventStream,
    };
  }),
);
