import { describe, expect, test } from "bun:test";
import {
  AgentConfig,
  AgentRuntimeConfig,
  TrackerConfig,
  WorkflowConfig,
} from "../../schemas/workflow.js";
import { Issue } from "../../schemas/issue.js";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { Effect, PubSub, Ref } from "effect";
import { ResolvedConfig } from "../config-service.js";
import {
  createRunningEntry,
  initialState,
  type OrchestratorState,
  type RetryEntry,
} from "../domain/orchestrator-state.js";
import { makeDispatchRuntime, type DispatchDeps } from "./dispatch.js";

const makeConfig = (options?: { readonly maxConcurrentAgents?: number }) =>
  new ResolvedConfig(
    new WorkflowConfig({
      tracker: new TrackerConfig({
        kind: "local-fs",
        dispatchStates: ["Todo", "In Progress"],
        parkedStates: ["Human Review"],
        terminalStates: ["Done"],
      }),
      agent: new AgentConfig({
        maxConcurrentAgents: options?.maxConcurrentAgents ?? 1,
        maxRetryBackoffMs: 60_000,
      }),
      codex: new AgentRuntimeConfig({
        stallTimeoutMs: 1_000,
      }),
    }),
  );

const makeIssue = (overrides?: Partial<Issue>) =>
  new Issue({
    id: overrides?.id ?? "issue-1",
    identifier: overrides?.identifier ?? "plot-1",
    title: overrides?.title ?? "test issue",
    description: overrides?.description ?? null,
    priority: overrides?.priority ?? 1,
    state: overrides?.state ?? "Todo",
    branchName: overrides?.branchName ?? null,
    url: overrides?.url ?? null,
    labels: overrides?.labels ?? [],
    blockedBy: overrides?.blockedBy ?? [],
    createdAt: overrides?.createdAt ?? null,
    updatedAt: overrides?.updatedAt ?? null,
  });

const makeDeps = async (
  state: OrchestratorState,
  overrides?: {
    readonly tracker?: DispatchDeps["tracker"];
    readonly getConfig?: DispatchDeps["getConfig"];
    readonly enqueueCommand?: DispatchDeps["enqueueCommand"];
  },
) => {
  const stateRef = await Effect.runPromise(Ref.make(state));
  const eventPubSub = await Effect.runPromise(PubSub.bounded<AgentRuntimeEvent>(16));
  const retryTimerFibersRef = await Effect.runPromise(
    Ref.make(new Map<string, import("effect").Fiber.RuntimeFiber<void, never>>()),
  );
  const deps: DispatchDeps = {
    stateRef,
    retryTimerFibersRef,
    workflowLoader: {
      getCurrent: Effect.succeed({ promptTemplate: "work" }),
    },
    tracker: overrides?.tracker ?? {
      fetchCandidateIssues: () => Effect.succeed([]),
      fetchIssueStatesByIds: () => Effect.succeed([]),
    },
    agentService: {
      run: () => {
        throw new Error("not used in test");
      },
    },
    workspaceManager: {
      ensureWorkspace: () => Effect.die("not used in test"),
      removeWorkspace: () => Effect.void,
      runHook: () => Effect.void,
    },
    eventPubSub,
    enqueueCommand: overrides?.enqueueCommand ?? (() => Effect.void),
    getConfig: overrides?.getConfig ?? Effect.succeed(makeConfig()),
    updateState: (fn) => Ref.update(stateRef, fn),
  };

  return { stateRef, runtime: makeDispatchRuntime(deps) };
};

describe("makeDispatchRuntime", () => {
  test("replaces the previous retry timer when rescheduling the same issue", async () => {
    const issueId = "issue-1";
    const { stateRef, runtime } = await makeDeps(initialState);

    await Effect.runPromise(
      Effect.scoped(runtime.scheduleRetry(issueId, "plot-1", 1, 60_000, null, "continuation")),
    );
    const afterFirst = await Effect.runPromise(Ref.get(stateRef));
    expect(afterFirst.retryAttempts.get(issueId)?.attempt).toBe(1);

    await Effect.runPromise(
      Effect.scoped(runtime.scheduleRetry(issueId, "plot-1", 2, 60_000, "boom", "failure")),
    );
    const afterSecond = await Effect.runPromise(Ref.get(stateRef));
    const scheduled = afterSecond.retryAttempts.get(issueId);
    expect(scheduled?.attempt).toBe(2);
    expect(scheduled?.reason).toBe("failure");
    expect(scheduled?.error).toBe("boom");

    await Effect.runPromise(Effect.scoped(runtime.clearRetryAttempt(issueId)));
    const finalState = await Effect.runPromise(Ref.get(stateRef));
    expect(finalState.retryAttempts.has(issueId)).toBeFalse();
  });

  test("releases the claim when a retry target is gone", async () => {
    const retryEntry: RetryEntry = {
      issueId: "issue-1",
      identifier: "plot-1",
      attempt: 2,
      dueAtMs: Date.now() - 100,
      error: "boom",
      reason: "failure",
    };
    const { stateRef, runtime } = await makeDeps(
      {
        ...initialState,
        claimed: new Set([retryEntry.issueId]),
        retryAttempts: new Map([[retryEntry.issueId, retryEntry]]),
      },
      {
        tracker: {
          fetchCandidateIssues: () => Effect.succeed([]),
          fetchIssueStatesByIds: () => Effect.succeed([]),
        },
      },
    );

    await Effect.runPromise(Effect.scoped(runtime.processRetry(retryEntry.issueId, retryEntry)));

    const nextState = await Effect.runPromise(Ref.get(stateRef));
    expect(nextState.claimed.has(retryEntry.issueId)).toBeFalse();
    expect(nextState.retryAttempts.has(retryEntry.issueId)).toBeFalse();
  });

  test("reschedules retries when dispatch is backpressured", async () => {
    const retryEntry: RetryEntry = {
      issueId: "issue-1",
      identifier: "plot-1",
      attempt: 3,
      dueAtMs: Date.now() - 100,
      error: "boom",
      reason: "failure",
    };
    const config = makeConfig({ maxConcurrentAgents: 1 });
    const blockedIssue = makeIssue({
      id: "issue-2",
      identifier: "plot-2",
      state: "In Progress",
    });
    const retryIssue = makeIssue({
      id: retryEntry.issueId,
      identifier: retryEntry.identifier,
      state: "Todo",
    });
    const { stateRef, runtime } = await makeDeps(
      {
        ...initialState,
        claimed: new Set([retryEntry.issueId]),
        running: new Map([
          [blockedIssue.id, createRunningEntry(blockedIssue, "/tmp/plot-2", Date.now())],
        ]),
        retryAttempts: new Map([[retryEntry.issueId, retryEntry]]),
      },
      {
        tracker: {
          fetchCandidateIssues: () => Effect.succeed([retryIssue]),
          fetchIssueStatesByIds: () => Effect.succeed([]),
        },
        getConfig: Effect.succeed(config),
      },
    );

    await Effect.runPromise(Effect.scoped(runtime.processRetry(retryEntry.issueId, retryEntry)));

    const nextState = await Effect.runPromise(Ref.get(stateRef));
    const scheduled = nextState.retryAttempts.get(retryEntry.issueId);
    expect(scheduled).toBeDefined();
    expect(scheduled?.attempt).toBe(retryEntry.attempt);
    expect(scheduled?.reason).toBe("backpressure");
    expect(scheduled?.error).toBe("no available orchestrator slots");
    expect(nextState.claimed.has(retryEntry.issueId)).toBeTrue();
    expect(nextState.retriesScheduledByReason.backpressure).toBe(1);
  });
});
