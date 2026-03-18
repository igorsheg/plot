import { Clock, Effect, Ref, type Scope } from "effect";
import type { Issue } from "@plot/sdk";
import { validateForDispatch, type ResolvedConfig } from "../config-service.js";
import {
  clearEventLog,
  incrementStaleRetryDropCount,
  isDispatchable,
  isEligible,
  isParked,
  isTerminal,
  sortCandidates,
  type OrchestratorState,
  type RetryEntry,
} from "../domain/orchestrator-state.js";
import type { OrchestratorCommand } from "./orchestrator-command.js";
import { withTrackerFallback } from "./tracker-fallback.js";

type StopReason = "terminal" | "inactive" | "stalled";

type StopOptions = {
  readonly reason: StopReason;
  readonly removeWorkspace: boolean;
  readonly releaseClaim: boolean;
  readonly log: Record<string, string>;
};

export interface ReconcileDeps {
  readonly stateRef: Ref.Ref<OrchestratorState>;
  readonly tracker: {
    readonly fetchIssueStatesByIds: (
      ids: readonly string[],
    ) => Effect.Effect<ReadonlyArray<{ id: string; state: string }>, unknown>;
    readonly fetchIssuesByStates: (
      states: string[],
    ) => Effect.Effect<ReadonlyArray<Issue>, unknown>;
    readonly fetchCandidateIssues: (
      states: string[],
    ) => Effect.Effect<ReadonlyArray<Issue>, unknown>;
  };
  readonly removeWorkspace: (
    identifier: string,
    config: ResolvedConfig,
  ) => Effect.Effect<void, unknown>;
  readonly getConfig: Effect.Effect<ResolvedConfig | null>;
  readonly updateState: (fn: (s: OrchestratorState) => OrchestratorState) => Effect.Effect<void>;
  readonly stopRunningIssue: (
    entry: OrchestratorState["running"] extends Map<string, infer R> ? R : never,
    config: ResolvedConfig,
    options: StopOptions,
  ) => Effect.Effect<void, unknown>;
  readonly processRetry: (
    issueId: string,
    entry: RetryEntry,
  ) => Effect.Effect<void, unknown, Scope.Scope>;
  readonly dispatchIssue: (
    issue: Issue,
    config: ResolvedConfig,
    attempt: number | null,
  ) => Effect.Effect<void, unknown, Scope.Scope>;
}

export function makeTickRuntime(deps: ReconcileDeps) {
  const reconcile = Effect.fnUntraced(function* (config: ResolvedConfig) {
      const state = yield* Ref.get(deps.stateRef);
      const runningIds = [...state.running.keys()];
      if (runningIds.length === 0) return;

      const stateEntries = yield* withTrackerFallback(
        deps.tracker.fetchIssueStatesByIds(runningIds),
        "reconcile_states",
        [] as ReadonlyArray<{ id: string; state: string }>,
      );

      const stateMap = new Map(stateEntries.map((e) => [e.id, e.state]));
      let stoppedCount = 0;

      const now = yield* Clock.currentTimeMillis;
      for (const [issueId, entry] of state.running) {
        const currentState = stateMap.get(issueId);

        if (currentState && isTerminal(currentState, config)) {
          yield* deps.stopRunningIssue(entry, config, {
            reason: "terminal",
            removeWorkspace: true,
            releaseClaim: true,
            log: { issue_state: currentState },
          });
          stoppedCount++;
          continue;
        }

        if (currentState && !isDispatchable(currentState, config)) {
          yield* deps.stopRunningIssue(entry, config, {
            reason: "inactive",
            removeWorkspace: false,
            releaseClaim: true,
            log: {
              issue_state: currentState,
              state_class: isParked(currentState, config) ? "parked" : "inactive",
            },
          });
          stoppedCount++;
          continue;
        }

        if (currentState) {
          yield* deps.updateState((s) => {
            const running = new Map(s.running);
            const existing = running.get(issueId);
            if (existing) running.set(issueId, { ...existing, state: currentState });
            return { ...s, running };
          });
        }

        if (config.stallTimeoutMs > 0) {
          const elapsed = now - entry.lastEventAt;
          if (elapsed > config.stallTimeoutMs) {
            yield* Effect.logWarning("stall_detected").pipe(
              Effect.annotateLogs({
                issue_id: issueId,
                identifier: entry.issueIdentifier,
                stalled_ms: String(elapsed),
              }),
            );
            yield* deps.stopRunningIssue(entry, config, {
              reason: "stalled",
              removeWorkspace: false,
              releaseClaim: true,
              log: { stalled_ms: String(elapsed) },
            });
            stoppedCount++;
          }
        }
      }

      yield* Effect.logInfo("reconcile").pipe(
        Effect.annotateLogs({
          checked: String(runningIds.length),
          stopped: String(stoppedCount),
        }),
      );
    });

  const startupTerminalCleanup = Effect.fnUntraced(function* (config: ResolvedConfig) {
      const terminalIssues = yield* withTrackerFallback(
        deps.tracker.fetchIssuesByStates(config.terminalStates as string[]),
        "startup_cleanup",
        [] as ReadonlyArray<Issue>,
      );

      let cleanedCount = 0;
      for (const issue of terminalIssues) {
        yield* deps.removeWorkspace(issue.identifier, config).pipe(Effect.ignore);
        yield* deps.updateState((s) => clearEventLog(s, issue.id));
        cleanedCount++;
      }

      if (cleanedCount > 0) {
        yield* Effect.logInfo("startup_terminal_cleanup").pipe(
          Effect.annotateLogs({ cleaned: String(cleanedCount) }),
        );
      }
    });

  const runTick = Effect.gen(function* () {
    const config = yield* deps.getConfig;
    if (!config) {
      yield* Effect.logWarning("tick_skip_no_workflow");
      return;
    }

    yield* reconcile(config);
    yield* validateForDispatch(config).pipe(
      Effect.catch((e) =>
        Effect.logError("dispatch_validation_failed").pipe(
          Effect.annotateLogs({ error: e.message }),
        ),
      ),
    );

    const candidates = yield* withTrackerFallback(
      deps.tracker.fetchCandidateIssues(config.dispatchStates as string[]),
      "tick_candidates",
      [] as ReadonlyArray<Issue>,
    );

    const sorted = sortCandidates(candidates);
    let dispatchedCount = 0;
    for (const issue of sorted) {
      const currentState = yield* Ref.get(deps.stateRef);
      if (!isEligible(issue, currentState, config)) continue;
      yield* deps.dispatchIssue(issue, config, null).pipe(
        Effect.catch((e) =>
          Effect.logError("dispatch_failed").pipe(
            Effect.annotateLogs({
              identifier: issue.identifier,
              error: String(e),
            }),
          ),
        ),
      );
      dispatchedCount++;
    }

    const currentState = yield* Ref.get(deps.stateRef);
    yield* Effect.logInfo("tick").pipe(
      Effect.annotateLogs({
        candidates: String(sorted.length),
        dispatched: String(dispatchedCount),
        running: String(currentState.running.size),
        retrying: String(currentState.retryAttempts.size),
      }),
    );
  }).pipe(Effect.withLogSpan("tick"));

  const handleRetryDue = Effect.fnUntraced(function* (command: Extract<OrchestratorCommand, { _tag: "retry_due" }>) {
      const retryEntry = (yield* Ref.get(deps.stateRef)).retryAttempts.get(command.issueId);
      if (!retryEntry) {
        yield* deps.updateState(incrementStaleRetryDropCount);
        return;
      }
      if (retryEntry.attempt !== command.attempt) {
        yield* deps.updateState(incrementStaleRetryDropCount);
        return;
      }
      const retryNow = yield* Clock.currentTimeMillis;
      if (retryEntry.dueAtMs > retryNow) {
        yield* deps.updateState(incrementStaleRetryDropCount);
        return;
      }

      yield* deps.processRetry(command.issueId, retryEntry).pipe(
        Effect.catch((e) =>
          Effect.logError("retry_due_failed").pipe(
            Effect.annotateLogs({
              issue_id: command.issueId,
              attempt: String(command.attempt),
              error: String(e),
            }),
          ),
        ),
      );
    });

  return {
    reconcile,
    startupTerminalCleanup,
    runTick,
    handleRetryDue,
  };
}
