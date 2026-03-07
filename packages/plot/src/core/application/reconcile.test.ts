import { describe, expect, test } from "bun:test";
import {
	AgentConfig,
	AgentRuntimeConfig,
	Issue,
	TrackerConfig,
	WorkflowConfig,
} from "@plot/sdk";
import { Effect, Ref } from "effect";
import { ResolvedConfig } from "../config-service.js";
import {
	createRunningEntry,
	initialState,
	type OrchestratorState,
	type RetryEntry,
} from "../domain/orchestrator-state.js";
import { makeTickRuntime, type ReconcileDeps } from "./reconcile.js";

const makeConfig = (options?: {
	readonly maxConcurrentAgents?: number;
	readonly stallTimeoutMs?: number;
}) =>
	new ResolvedConfig(
		new WorkflowConfig({
			tracker: new TrackerConfig({
				kind: "local-fs",
				activeStates: ["Todo", "In Progress"],
				terminalStates: ["Done"],
			}),
			agent: new AgentConfig({
				maxConcurrentAgents: options?.maxConcurrentAgents ?? 2,
				maxRetryBackoffMs: 60_000,
			}),
			codex: new AgentRuntimeConfig({
				stallTimeoutMs: options?.stallTimeoutMs ?? 1_000,
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
		readonly tracker?: ReconcileDeps["tracker"];
		readonly stopRunningIssue?: ReconcileDeps["stopRunningIssue"];
		readonly processRetry?: ReconcileDeps["processRetry"];
		readonly dispatchIssue?: ReconcileDeps["dispatchIssue"];
		readonly getConfig?: ReconcileDeps["getConfig"];
	},
) => {
	const stateRef = await Effect.runPromise(Ref.make(state));
	const deps: ReconcileDeps = {
		stateRef,
		tracker: overrides?.tracker ?? {
			fetchIssueStatesByIds: () => Effect.succeed([]),
			fetchIssuesByStates: () => Effect.succeed([]),
			fetchCandidateIssues: () => Effect.succeed([]),
		},
		removeWorkspace: () => Effect.void,
		getConfig: overrides?.getConfig ?? Effect.succeed(makeConfig()),
		updateState: (fn) => Ref.update(stateRef, fn),
		stopRunningIssue: overrides?.stopRunningIssue ?? (() => Effect.void),
		processRetry: overrides?.processRetry ?? (() => Effect.void),
		dispatchIssue: overrides?.dispatchIssue ?? (() => Effect.void),
	};

	return { stateRef, runtime: makeTickRuntime(deps) };
};

describe("makeTickRuntime", () => {
	test("drops stale retry_due commands when the attempt no longer matches", async () => {
		const retryEntry: RetryEntry = {
			issueId: "issue-1",
			identifier: "plot-1",
			attempt: 2,
			dueAtMs: Date.now() - 100,
			error: "boom",
			reason: "failure",
		};
		const processCalls: string[] = [];
		const { stateRef, runtime } = await makeDeps(
			{
				...initialState,
				retryAttempts: new Map([[retryEntry.issueId, retryEntry]]),
			},
			{
				processRetry: (issueId) =>
					Effect.sync(() => {
						processCalls.push(issueId);
					}),
			},
		);

		await Effect.runPromise(
			Effect.scoped(
				runtime.handleRetryDue({
					_tag: "retry_due",
					issueId: retryEntry.issueId,
					attempt: 1,
				}),
			),
		);

		const nextState = await Effect.runPromise(Ref.get(stateRef));
		expect(nextState.staleRetryDropCount).toBe(1);
		expect(processCalls).toEqual([]);
	});

	test("reconcile stops a terminal worker once even when it is also stalled", async () => {
		const config = makeConfig({ stallTimeoutMs: 1_000 });
		const issue = makeIssue({ state: "In Progress" });
		const startedAt = Date.now() - 10_000;
		const entry = {
			...createRunningEntry(issue, "/tmp/plot-1", startedAt),
			lastEventAt: startedAt,
		};
		const stopReasons: string[] = [];
		const { runtime } = await makeDeps(
			{
				...initialState,
				running: new Map([[issue.id, entry]]),
			},
			{
				tracker: {
					fetchIssueStatesByIds: () =>
						Effect.succeed([{ id: issue.id, state: "Done" }]),
					fetchIssuesByStates: () => Effect.succeed([]),
					fetchCandidateIssues: () => Effect.succeed([]),
				},
				getConfig: Effect.succeed(config),
				stopRunningIssue: (_entry, _config, options) =>
					Effect.sync(() => {
						stopReasons.push(options.reason);
					}),
			},
		);

		await Effect.runPromise(runtime.reconcile(config));

		expect(stopReasons).toEqual(["terminal"]);
	});
});
