import { Effect, Ref, Fiber, Stream, DateTime, Exit, Scope, Deferred, PubSub } from "effect";
import type { Issue, AgentRuntimeEvent } from "@plot/shared";
import { TrackerClient } from "@plot/tracker";
import { AgentService, type AgentRunConfig } from "@plot/agent";
import { WorkflowLoader } from "./workflow-loader.js";
import { ResolvedConfig, validateForDispatch } from "./config-service.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { renderPrompt } from "./prompt-renderer.js";

// ---------------------------------------------------------------------------
// state types
// ---------------------------------------------------------------------------

interface RunningEntry {
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
}

interface RetryEntry {
  readonly issueId: string;
  readonly identifier: string;
  readonly attempt: number;
  readonly dueAtMs: number;
  readonly error: string | null;
}

interface OrchestratorState {
  readonly running: Map<string, RunningEntry>;
  readonly claimed: Set<string>;
  readonly retryAttempts: Map<string, RetryEntry>;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalTokens: number;
  readonly endedSessionSeconds: number;
}

const initialState: OrchestratorState = {
  running: new Map(),
  claimed: new Set(),
  retryAttempts: new Map(),
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalTokens: 0,
  endedSessionSeconds: 0,
};

// ---------------------------------------------------------------------------
// retry math
// ---------------------------------------------------------------------------

const computeRetryDelay = (attempt: number, maxBackoffMs: number): number =>
  Math.min(10_000 * Math.pow(2, attempt - 1), maxBackoffMs);

const CONTINUATION_DELAY_MS = 5_000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const normalizeState = (s: string) => s.trim().toLowerCase();

const isActive = (state: string, config: ResolvedConfig) =>
  config.activeStates.some((a) => normalizeState(a) === normalizeState(state));

const isTerminal = (state: string, config: ResolvedConfig) =>
  config.terminalStates.some((t) => normalizeState(t) === normalizeState(state));

const availableSlots = (state: OrchestratorState, config: ResolvedConfig): number =>
  Math.max(config.maxConcurrentAgents - state.running.size, 0);

const perStateSlots = (
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

const hasNonTerminalBlockers = (issue: Issue, config: ResolvedConfig): boolean =>
  issue.blockedBy.some((b) => b.state !== null && !isTerminal(b.state, config));

const isEligible = (issue: Issue, state: OrchestratorState, config: ResolvedConfig): boolean => {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false;
  if (!isActive(issue.state, config)) return false;
  if (isTerminal(issue.state, config)) return false;
  if (state.running.has(issue.id)) return false;
  if (state.claimed.has(issue.id)) return false;
  if (availableSlots(state, config) <= 0) return false;
  if (perStateSlots(issue.state, state, config) <= 0) return false;
  if (normalizeState(issue.state) === "todo" && hasNonTerminalBlockers(issue, config)) return false;
  return true;
};

const sortCandidates = (issues: ReadonlyArray<Issue>): ReadonlyArray<Issue> =>
  [...issues].sort((a, b) => {
    const pa = a.priority ?? 999;
    const pb = b.priority ?? 999;
    if (pa !== pb) return pa - pb;
    const ca = a.createdAt ? Number(DateTime.toEpochMillis(a.createdAt)) : Infinity;
    const cb = b.createdAt ? Number(DateTime.toEpochMillis(b.createdAt)) : Infinity;
    if (ca !== cb) return ca - cb;
    return a.identifier.localeCompare(b.identifier);
  });

// ---------------------------------------------------------------------------
// orchestrator service
// ---------------------------------------------------------------------------

export class Orchestrator extends Effect.Service<Orchestrator>()("Orchestrator", {
  effect: Effect.gen(function* () {
    const stateRef = yield* Ref.make<OrchestratorState>(initialState);
    const workflowLoader = yield* WorkflowLoader;
    const tracker = yield* TrackerClient;
    const agentService = yield* AgentService;
    const workspaceManager = yield* WorkspaceManager;
    const eventPubSub = yield* PubSub.unbounded<AgentRuntimeEvent>();
    const retryWakeRef = yield* Ref.make<Deferred.Deferred<void>>(yield* Deferred.make<void>());

    // -----------------------------------------------------------------------
    // state access
    // -----------------------------------------------------------------------

    const getState = Ref.get(stateRef);

    const getConfig = Effect.gen(function* () {
      const wf = yield* workflowLoader.getCurrent;
      if (!wf) return null;
      return new ResolvedConfig(wf.config);
    });

    const updateState = (fn: (s: OrchestratorState) => OrchestratorState) =>
      Ref.update(stateRef, fn);

    // -----------------------------------------------------------------------
    // event consumption — updates running entry from agent events
    // -----------------------------------------------------------------------

    const consumeEvent = (event: AgentRuntimeEvent) =>
      updateState((s) => {
        const entry = s.running.get(event.issueId);
        if (!entry) return s;

        const running = new Map(s.running);
        let { sessionId, turnCount, inputTokens, outputTokens, totalTokens } = entry;

        if (event.sessionId) sessionId = event.sessionId;
        if (event.event === "turn_completed" || event.event === "turn_failed") turnCount += 1;

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

        const MAX_EVENT_TAIL = 200;
        const eventTail =
          entry.eventTail.length >= MAX_EVENT_TAIL
            ? [...entry.eventTail.slice(-(MAX_EVENT_TAIL - 1)), event]
            : [...entry.eventTail, event];

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
        });

        return {
          ...s,
          running,
          totalInputTokens: s.totalInputTokens + Math.max(deltaInput, 0),
          totalOutputTokens: s.totalOutputTokens + Math.max(deltaOutput, 0),
          totalTokens: s.totalTokens + Math.max(deltaTotal, 0),
        };
      });

    // -----------------------------------------------------------------------
    // retry scheduling — single scheduler fiber, wake-on-insert
    // -----------------------------------------------------------------------

    const scheduleRetry = (
      issueId: string,
      identifier: string,
      attempt: number,
      delayMs: number,
      error: string | null,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        const dueAtMs = Date.now() + delayMs;
        yield* updateState((s) => {
          const retryAttempts = new Map(s.retryAttempts);
          retryAttempts.set(issueId, { issueId, identifier, attempt, dueAtMs, error });
          const claimed = new Set(s.claimed);
          claimed.add(issueId);
          return { ...s, retryAttempts, claimed };
        });

        yield* Effect.logInfo("retry_scheduled").pipe(
          Effect.annotateLogs({
            issue_id: issueId,
            identifier,
            attempt: String(attempt),
            delay_ms: String(delayMs),
            error: error ?? "continuation",
          }),
        );

        const wake = yield* Ref.get(retryWakeRef);
        yield* Deferred.succeed(wake, undefined).pipe(Effect.ignore);
      });

    const processRetry = (issueId: string, entry: RetryEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* updateState((s) => {
          const retryAttempts = new Map(s.retryAttempts);
          retryAttempts.delete(issueId);
          return { ...s, retryAttempts };
        });

        const config = yield* getConfig;
        if (!config) {
          yield* releaseClaim(issueId);
          return;
        }

        const candidates = yield* tracker
          .fetchCandidateIssues(config.activeStates as string[])
          .pipe(
            Effect.tapError((e) =>
              Effect.logWarning("tracker_fetch_failed").pipe(
                Effect.annotateLogs({ operation: "retry_candidates", error: String(e) }),
              ),
            ),
            Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<Issue>)),
          );

        const issue = candidates.find((i) => i.id === issueId);
        if (!issue) {
          yield* releaseClaim(issueId);
          yield* Effect.logInfo("retry_issue_gone").pipe(
            Effect.annotateLogs({ issue_id: issueId, identifier: entry.identifier }),
          );
          return;
        }

        const currentState = yield* Ref.get(stateRef);
        if (availableSlots(currentState, config) <= 0) {
          const delay = computeRetryDelay(entry.attempt + 1, config.maxRetryBackoffMs);
          yield* scheduleRetry(
            issueId,
            entry.identifier,
            entry.attempt + 1,
            delay,
            "no available orchestrator slots",
          );
          return;
        }

        yield* dispatchIssue(issue, config, entry.attempt).pipe(
          Effect.catchAll((e) =>
            Effect.logError("retry_dispatch_failed").pipe(
              Effect.annotateLogs({
                issue_id: issueId,
                identifier: entry.identifier,
                error: String(e),
              }),
            ),
          ),
        );
      });

    const retrySchedulerLoop: Effect.Effect<void> = Effect.gen(function* () {
      while (true) {
        const state = yield* Ref.get(stateRef);
        const entries = [...state.retryAttempts.values()];
        const now = Date.now();

        const due = entries.filter((e) => e.dueAtMs <= now);
        if (due.length > 0) {
          for (const entry of due) {
            yield* processRetry(entry.issueId, entry).pipe(
              Effect.catchAll((e) =>
                Effect.logError("retry_process_failed").pipe(
                  Effect.annotateLogs({ issue_id: entry.issueId, error: String(e) }),
                ),
              ),
            );
          }
          continue;
        }

        const nextDue = entries.reduce((min, e) => Math.min(min, e.dueAtMs), Infinity);

        const newWake = yield* Deferred.make<void>();
        const oldWake = yield* Ref.getAndSet(retryWakeRef, newWake);
        yield* Deferred.succeed(oldWake, undefined).pipe(Effect.ignore);

        if (nextDue === Infinity) {
          yield* Deferred.await(newWake);
        } else {
          const sleepMs = Math.max(nextDue - Date.now(), 100);
          yield* Deferred.await(newWake).pipe(Effect.race(Effect.sleep(`${sleepMs} millis`)));
        }
      }
    });

    // -----------------------------------------------------------------------
    // claim / release
    // -----------------------------------------------------------------------

    const releaseClaim = (issueId: string) =>
      updateState((s) => {
        const claimed = new Set(s.claimed);
        claimed.delete(issueId);
        return { ...s, claimed };
      });

    // -----------------------------------------------------------------------
    // worker lifecycle — acquire / run / finalize
    // -----------------------------------------------------------------------

    const runAfterRunHook = (config: ResolvedConfig, wsPath: string) =>
      config.hooksAfterRun
        ? workspaceManager
            .runHook(config.hooksAfterRun, wsPath, config.hooksTimeoutMs)
            .pipe(
              Effect.catchAll((e) =>
                Effect.logWarning("after_run_hook_failed").pipe(
                  Effect.annotateLogs({ error: String(e) }),
                ),
              ),
            )
        : Effect.void;

    const removeRunningEntry = (issueId: string) =>
      updateState((s) => {
        const entry = s.running.get(issueId);
        if (!entry) return s;
        const running = new Map(s.running);
        running.delete(issueId);
        const elapsed = (Date.now() - entry.startedAt) / 1000;
        return {
          ...s,
          running,
          endedSessionSeconds: s.endedSessionSeconds + elapsed,
        };
      });

    const finalizeWorkerExit = (
      issueId: string,
      identifier: string,
      attempt: number | null,
      config: ResolvedConfig,
      wsPath: string,
      exit: Exit.Exit<void, unknown>,
    ): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* removeRunningEntry(issueId);
        yield* runAfterRunHook(config, wsPath);

        if (Exit.isSuccess(exit)) {
          yield* scheduleRetry(issueId, identifier, 1, CONTINUATION_DELAY_MS, null);
        } else if (Exit.isInterrupted(exit)) {
          yield* releaseClaim(issueId);
          yield* Effect.logInfo("worker_interrupted").pipe(
            Effect.annotateLogs({ issue_id: issueId, identifier }),
          );
        } else {
          const error = Exit.isFailure(exit) ? String(exit.cause) : "unknown";
          yield* Effect.logError("agent_failed").pipe(
            Effect.annotateLogs({ issue_id: issueId, identifier, error }),
          );
          const nextAttempt = (attempt ?? 0) + 1;
          const delay = computeRetryDelay(nextAttempt, config.maxRetryBackoffMs);
          yield* scheduleRetry(issueId, identifier, nextAttempt, delay, error);
        }
      });

    const dispatchIssue = (issue: Issue, config: ResolvedConfig, attempt: number | null) =>
      Effect.gen(function* () {
        // --- claim ---
        yield* updateState((s) => {
          const claimed = new Set(s.claimed);
          claimed.add(issue.id);
          const retryAttempts = new Map(s.retryAttempts);
          retryAttempts.delete(issue.id);
          return { ...s, claimed, retryAttempts };
        });

        // --- acquire workspace + hooks ---
        const ws = yield* workspaceManager
          .ensureWorkspace(issue.identifier, config)
          .pipe(Effect.tapError(() => releaseClaim(issue.id)));

        if (config.hooksBeforeRun) {
          yield* workspaceManager
            .runHook(config.hooksBeforeRun, ws.path, config.hooksTimeoutMs)
            .pipe(
              Effect.tapError(() =>
                runAfterRunHook(config, ws.path).pipe(Effect.flatMap(() => releaseClaim(issue.id))),
              ),
            );
        }

        // --- build prompt ---
        const wf = yield* workflowLoader.getCurrent;
        if (!wf) {
          yield* releaseClaim(issue.id);
          return;
        }

        const prompt = yield* renderPrompt(
          wf.promptTemplate || "You are working on an issue.",
          issue,
          attempt,
        ).pipe(
          Effect.tapError(() =>
            runAfterRunHook(config, ws.path).pipe(Effect.flatMap(() => releaseClaim(issue.id))),
          ),
        );

        yield* Effect.logInfo("dispatch").pipe(
          Effect.annotateLogs({
            workspace: ws.path,
            workspace_created: String(ws.createdNow),
            prompt_length: String(prompt.length),
          }),
        );

        // --- build agent config ---
        const shouldContinue = async (): Promise<boolean> => {
          const result = await Effect.runPromise(
            tracker
              .fetchIssueStatesByIds([issue.id])
              .pipe(Effect.catchAll(() => Effect.succeed([] as const))),
          );
          const entry = result.find((e) => e.id === issue.id);
          if (!entry) return false;
          return isActive(entry.state, config) && !isTerminal(entry.state, config);
        };

        const agentConfig: AgentRunConfig = {
          systemPrompt: prompt,
          prompt: `Work on issue ${issue.identifier}: ${issue.title}\n\n${issue.description ?? ""}`,
          workspacePath: ws.path,
          issueId: issue.id,
          issueIdentifier: issue.identifier,
          maxTurns: config.maxTurns,
          turnTimeoutMs: config.turnTimeoutMs,
          shouldContinue,
        };

        const abortController = new AbortController();

        // --- register running entry BEFORE fork to prevent finalize race ---
        const now = Date.now();
        const registered = yield* Deferred.make<void>();

        yield* updateState((s) => {
          const running = new Map(s.running);
          running.set(issue.id, {
            issueId: issue.id,
            issueIdentifier: issue.identifier,
            issue,
            state: issue.state,
            startedAt: now,
            fiber: null,
            turnCount: 0,
            lastEventAt: now,
            sessionId: null,
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            workspacePath: ws.path,
            lastMessage: null,
            eventTail: [],
          });
          return { ...s, running };
        });

        // --- fork worker with onExit finalization ---
        const fiber = yield* Effect.fork(
          Deferred.await(registered).pipe(
            Effect.flatMap(() =>
              agentService.run(agentConfig, abortController.signal).pipe(
                Stream.tap((event) =>
                  Effect.all([eventPubSub.publish(event), consumeEvent(event)]),
                ),
                Stream.runDrain,
              ),
            ),
            Effect.onExit((exit) =>
              finalizeWorkerExit(issue.id, issue.identifier, attempt, config, ws.path, exit),
            ),
          ),
        );

        // --- update entry with real fiber ref, then ungate ---
        yield* updateState((s) => {
          const running = new Map(s.running);
          const entry = running.get(issue.id);
          if (entry) running.set(issue.id, { ...entry, fiber });
          return { ...s, running };
        });
        yield* Deferred.succeed(registered, undefined);
      }).pipe(
        Effect.annotateLogs({
          issue_id: issue.id,
          identifier: issue.identifier,
          state: issue.state,
          priority: String(issue.priority ?? -1),
        }),
      );

    // -----------------------------------------------------------------------
    // reconciliation
    // -----------------------------------------------------------------------

    const reconcile = (config: ResolvedConfig) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const runningIds = [...state.running.keys()];
        if (runningIds.length === 0) return;

        const stateEntries = yield* tracker
          .fetchIssueStatesByIds(runningIds)
          .pipe(
            Effect.tapError((e) =>
              Effect.logWarning("tracker_fetch_failed").pipe(
                Effect.annotateLogs({ operation: "reconcile_states", error: String(e) }),
              ),
            ),
            Effect.catchAll(() => Effect.succeed([] as const)),
          );

        const stateMap = new Map(stateEntries.map((e) => [e.id, e.state]));

        let stoppedCount = 0;
        for (const [issueId, entry] of state.running) {
          const currentState = stateMap.get(issueId);

          if (currentState && isTerminal(currentState, config)) {
            if (entry.fiber) yield* Fiber.interrupt(entry.fiber);
            yield* workspaceManager
              .removeWorkspace(entry.issueIdentifier, config)
              .pipe(Effect.ignore);
            stoppedCount++;
          } else if (currentState && !isActive(currentState, config)) {
            if (entry.fiber) yield* Fiber.interrupt(entry.fiber);
            stoppedCount++;
          } else if (currentState) {
            yield* updateState((s) => {
              const running = new Map(s.running);
              const existing = running.get(issueId);
              if (existing) running.set(issueId, { ...existing, state: currentState });
              return { ...s, running };
            });
          }

          if (config.stallTimeoutMs > 0) {
            const elapsed = Date.now() - entry.lastEventAt;
            if (elapsed > config.stallTimeoutMs) {
              yield* Effect.logWarning("stall_detected").pipe(
                Effect.annotateLogs({
                  issue_id: issueId,
                  identifier: entry.issueIdentifier,
                  stalled_ms: String(elapsed),
                }),
              );
              if (entry.fiber) yield* Fiber.interrupt(entry.fiber);
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

    // -----------------------------------------------------------------------
    // startup terminal cleanup
    // -----------------------------------------------------------------------

    const startupTerminalCleanup = (config: ResolvedConfig) =>
      Effect.gen(function* () {
        const terminalIssues = yield* tracker
          .fetchIssuesByStates(config.terminalStates as string[])
          .pipe(
            Effect.tapError((e) =>
              Effect.logWarning("tracker_fetch_failed").pipe(
                Effect.annotateLogs({ operation: "startup_cleanup", error: String(e) }),
              ),
            ),
            Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<Issue>)),
          );

        let cleanedCount = 0;
        for (const issue of terminalIssues) {
          yield* workspaceManager.removeWorkspace(issue.identifier, config).pipe(Effect.ignore);
          cleanedCount++;
        }

        if (cleanedCount > 0) {
          yield* Effect.logInfo("startup_terminal_cleanup").pipe(
            Effect.annotateLogs({ cleaned: String(cleanedCount) }),
          );
        }
      });

    // -----------------------------------------------------------------------
    // tick
    // -----------------------------------------------------------------------

    const tick = Effect.gen(function* () {
      const config = yield* getConfig;
      if (!config) {
        yield* Effect.logWarning("tick_skip_no_workflow");
        return;
      }

      yield* reconcile(config);
      yield* validateForDispatch(config).pipe(
        Effect.catchAll((e) =>
          Effect.logError("dispatch_validation_failed").pipe(
            Effect.annotateLogs({ error: e.message }),
          ),
        ),
      );

      const candidates = yield* tracker
        .fetchCandidateIssues(config.activeStates as string[])
        .pipe(
          Effect.catchAll((e) =>
            Effect.succeed([] as ReadonlyArray<Issue>).pipe(
              Effect.tap(
                Effect.logError("tracker_fetch_failed").pipe(
                  Effect.annotateLogs({ error: String(e) }),
                ),
              ),
            ),
          ),
        );

      const sorted = sortCandidates(candidates);

      let dispatchedCount = 0;
      for (const issue of sorted) {
        const currentState = yield* Ref.get(stateRef);
        if (!isEligible(issue, currentState, config)) continue;
        yield* dispatchIssue(issue, config, null).pipe(
          Effect.catchAll((e) =>
            Effect.logError("dispatch_failed").pipe(
              Effect.annotateLogs({ identifier: issue.identifier, error: String(e) }),
            ),
          ),
        );
        dispatchedCount++;
      }

      const currentState = yield* Ref.get(stateRef);
      yield* Effect.logInfo("tick").pipe(
        Effect.annotateLogs({
          candidates: String(sorted.length),
          dispatched: String(dispatchedCount),
          running: String(currentState.running.size),
          retrying: String(currentState.retryAttempts.size),
        }),
      );
    }).pipe(Effect.withLogSpan("tick"));

    // -----------------------------------------------------------------------
    // poll loop
    // -----------------------------------------------------------------------

    const pollLoop: Effect.Effect<never> = Effect.gen(function* () {
      while (true) {
        const config = yield* getConfig;
        const interval = config?.pollIntervalMs ?? 30_000;
        yield* Effect.sleep(`${interval} millis`);
        yield* tick;
      }
    });

    // -----------------------------------------------------------------------
    // start
    // -----------------------------------------------------------------------

    const start = (workflowPath: string): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        yield* workflowLoader.load(workflowPath).pipe(Effect.catchAll((e) => Effect.die(e)));

        const config = yield* getConfig;

        yield* Effect.logInfo("orchestrator_started").pipe(
          Effect.annotateLogs({ workflow: workflowPath }),
        );

        if (config) {
          yield* startupTerminalCleanup(config);
        }

        yield* workflowLoader.startWatching(workflowPath);

        yield* tick;

        yield* Effect.forkScoped(retrySchedulerLoop);
        yield* Effect.forkScoped(pollLoop);
      });

    const eventStream = Stream.fromPubSub(eventPubSub);

    return { start, tick, getState, getConfig, eventStream };
  }),
  dependencies: [WorkflowLoader.Default, WorkspaceManager.Default],
}) {}
