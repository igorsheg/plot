import {
	Deferred,
	Effect,
	Exit,
	Fiber,
	PubSub,
	Ref,
	Scope,
	Stream,
} from "effect";
import type { AgentRuntimeEvent } from "@plot/sdk";
import type { Issue } from "../../schemas/issue.js";
import { renderPrompt } from "../prompt-renderer.js";
import type { ResolvedConfig } from "../config-service.js";
import type { AgentRunConfig } from "../ports.js";
import type {
	OrchestratorCommand,
	WorkerExitCommand,
} from "./orchestrator-command.js";
import {
	CONTINUATION_DELAY_MS,
	computeRetryDelay,
} from "./orchestrator-command.js";
import {
	availableSlots,
	clearEventLog,
	clearRetryAttemptFromState,
	createRunningEntry,
	isDispatchable,
	isTerminal,
	removeRunningEntryFromState,
	releaseClaimFromState,
	type OrchestratorState,
	type RetryEntry,
	type RetryReason,
	type RunningEntry,
} from "../domain/orchestrator-state.js";

export interface DispatchDeps {
	readonly stateRef: Ref.Ref<OrchestratorState>;
	readonly retryTimerFibersRef: Ref.Ref<
		Map<string, Fiber.RuntimeFiber<void, never>>
	>;
	readonly workflowLoader: {
		readonly getCurrent: Effect.Effect<{ promptTemplate: string } | null>;
	};
	readonly tracker: {
		readonly fetchCandidateIssues: (
			states: string[],
		) => Effect.Effect<ReadonlyArray<Issue>, unknown>;
		readonly fetchIssueStatesByIds: (
			ids: readonly string[],
		) => Effect.Effect<ReadonlyArray<{ id: string; state: string }>, unknown>;
	};
	readonly agentService: {
		readonly run: (
			config: AgentRunConfig,
			signal: AbortSignal,
		) => Stream.Stream<AgentRuntimeEvent, unknown>;
	};
	readonly workspaceManager: {
		readonly ensureWorkspace: (
			identifier: string,
			config: ResolvedConfig,
		) => Effect.Effect<{ path: string; createdNow: boolean }, unknown>;
		readonly removeWorkspace: (
			identifier: string,
			config: ResolvedConfig,
		) => Effect.Effect<void, unknown>;
		readonly runHook: (
			script: string,
			cwd: string,
			timeoutMs: number,
		) => Effect.Effect<void, unknown>;
	};
	readonly eventPubSub: PubSub.PubSub<AgentRuntimeEvent>;
	readonly enqueueCommand: (
		command: OrchestratorCommand,
	) => Effect.Effect<void, never, Scope.Scope>;
	readonly getConfig: Effect.Effect<ResolvedConfig | null>;
	readonly updateState: (
		fn: (s: OrchestratorState) => OrchestratorState,
	) => Effect.Effect<void>;
}

export function makeDispatchRuntime(deps: DispatchDeps) {
	const releaseClaim = (issueId: string) =>
		deps.updateState((s) => releaseClaimFromState(s, issueId));

	const takeRetryTimerFiber = (issueId: string) =>
		Ref.modify(deps.retryTimerFibersRef, (timers) => {
			const next = new Map(timers);
			const fiber = next.get(issueId) ?? null;
			next.delete(issueId);
			return [fiber, next] as const;
		});

	const replaceRetryTimerFiber = (
		issueId: string,
		fiber: Fiber.RuntimeFiber<void, never>,
	) =>
		Ref.modify(deps.retryTimerFibersRef, (timers) => {
			const next = new Map(timers);
			const previous = next.get(issueId) ?? null;
			next.set(issueId, fiber);
			return [previous, next] as const;
		});

	const clearRetryAttempt = (issueId: string) =>
		Effect.gen(function* () {
			const timerFiber = yield* takeRetryTimerFiber(issueId);
			if (timerFiber) {
				yield* Fiber.interrupt(timerFiber);
			}
			yield* deps.updateState((s) => clearRetryAttemptFromState(s, issueId));
		});

	const runAfterRunHook = (config: ResolvedConfig, wsPath: string) =>
		config.hooksAfterRun
			? deps.workspaceManager
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
		deps.updateState((s) =>
			removeRunningEntryFromState(s, issueId, Date.now()),
		);

	const scheduleRetry = (
		issueId: string,
		identifier: string,
		attempt: number,
		delayMs: number,
		error: string | null,
		reason: RetryReason,
	): Effect.Effect<void, never, Scope.Scope> =>
		Effect.gen(function* () {
			const dueAtMs = Date.now() + delayMs;
			yield* deps.updateState((s) => {
				const retryAttempts = new Map(s.retryAttempts);
				retryAttempts.set(issueId, {
					issueId,
					identifier,
					attempt,
					dueAtMs,
					error,
					reason,
				});
				const claimed = new Set(s.claimed);
				claimed.add(issueId);
				return {
					...s,
					retryAttempts,
					claimed,
					retriesScheduledByReason: {
						...s.retriesScheduledByReason,
						[reason]: s.retriesScheduledByReason[reason] + 1,
					},
				};
			});

			yield* Effect.logInfo("retry_scheduled").pipe(
				Effect.annotateLogs({
					issue_id: issueId,
					identifier,
					attempt: String(attempt),
					delay_ms: String(delayMs),
					error: error ?? "continuation",
					reason,
				}),
			);

			const timerFiber = yield* Effect.sleep(
				`${Math.max(delayMs, 0)} millis`,
			).pipe(
				Effect.zipRight(
					deps.enqueueCommand({ _tag: "retry_due", issueId, attempt }),
				),
				Effect.forkScoped,
			);
			const previousTimerFiber = yield* replaceRetryTimerFiber(
				issueId,
				timerFiber,
			);
			if (previousTimerFiber) {
				yield* Fiber.interrupt(previousTimerFiber);
			}
		}).pipe(Effect.asVoid);

	const stopRunningIssue = (
		entry: RunningEntry,
		config: ResolvedConfig,
		options: {
			readonly reason: "terminal" | "inactive" | "stalled";
			readonly removeWorkspace: boolean;
			readonly releaseClaim: boolean;
			readonly log: Record<string, string>;
		},
	): Effect.Effect<void> =>
		Effect.gen(function* () {
			if (entry.fiber) {
				yield* Fiber.interrupt(entry.fiber);
			}
			if (options.removeWorkspace) {
				yield* deps.workspaceManager
					.removeWorkspace(entry.issueIdentifier, config)
					.pipe(Effect.ignore);
			}
			yield* clearRetryAttempt(entry.issueId);
			if (options.reason === "terminal") {
				yield* deps.updateState((s) => clearEventLog(s, entry.issueId));
			}
			yield* deps.updateState((s) => ({
				...s,
				workerStopsByReason: {
					...s.workerStopsByReason,
					[options.reason]: s.workerStopsByReason[options.reason] + 1,
				},
			}));
			if (options.releaseClaim) {
				yield* releaseClaim(entry.issueId);
			}
			yield* Effect.logInfo("worker_stopped").pipe(
				Effect.annotateLogs({
					issue_id: entry.issueId,
					identifier: entry.issueIdentifier,
					stop_reason: options.reason,
					...options.log,
				}),
			);
		});

	const handleWorkerExit = ({
		issueId,
		identifier,
		attempt,
		config,
		workspacePath,
		exit,
	}: WorkerExitCommand): Effect.Effect<void, never, Scope.Scope> =>
		Effect.gen(function* () {
			yield* removeRunningEntry(issueId);
			yield* runAfterRunHook(config, workspacePath);

			if (Exit.isSuccess(exit)) {
				yield* deps.updateState((s) => ({
					...s,
					workerExitsByReason: {
						...s.workerExitsByReason,
						success: s.workerExitsByReason.success + 1,
					},
				}));
				yield* scheduleRetry(
					issueId,
					identifier,
					1,
					CONTINUATION_DELAY_MS,
					null,
					"continuation",
				);
			} else if (Exit.isInterrupted(exit)) {
				yield* deps.updateState((s) => ({
					...s,
					workerExitsByReason: {
						...s.workerExitsByReason,
						interrupted: s.workerExitsByReason.interrupted + 1,
					},
				}));
				yield* releaseClaim(issueId);
				yield* Effect.logInfo("worker_interrupted").pipe(
					Effect.annotateLogs({ issue_id: issueId, identifier }),
				);
			} else {
				yield* deps.updateState((s) => ({
					...s,
					workerExitsByReason: {
						...s.workerExitsByReason,
						failure: s.workerExitsByReason.failure + 1,
					},
				}));
				const error = Exit.isFailure(exit) ? String(exit.cause) : "unknown";
				yield* Effect.logError("agent_failed").pipe(
					Effect.annotateLogs({ issue_id: issueId, identifier, error }),
				);
				const nextAttempt = (attempt ?? 0) + 1;
				const delay = computeRetryDelay(nextAttempt, config.maxRetryBackoffMs);
				yield* scheduleRetry(
					issueId,
					identifier,
					nextAttempt,
					delay,
					error,
					"failure",
				);
			}
		});

	const dispatchIssue = (
		issue: Issue,
		config: ResolvedConfig,
		attempt: number | null,
	) =>
		Effect.gen(function* () {
			yield* deps.updateState((s) => {
				const claimed = new Set(s.claimed);
				claimed.add(issue.id);
				const retryAttempts = new Map(s.retryAttempts);
				retryAttempts.delete(issue.id);
				return { ...s, claimed, retryAttempts };
			});

			const ws = yield* deps.workspaceManager
				.ensureWorkspace(issue.identifier, config)
				.pipe(Effect.tapError(() => releaseClaim(issue.id)));

			if (config.hooksBeforeRun) {
				yield* deps.workspaceManager
					.runHook(config.hooksBeforeRun, ws.path, config.hooksTimeoutMs)
					.pipe(
						Effect.tapError(() =>
							runAfterRunHook(config, ws.path).pipe(
								Effect.flatMap(() => releaseClaim(issue.id)),
							),
						),
					);
			}

			const wf = yield* deps.workflowLoader.getCurrent;
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
					runAfterRunHook(config, ws.path).pipe(
						Effect.flatMap(() => releaseClaim(issue.id)),
					),
				),
			);

			yield* Effect.logInfo("dispatch").pipe(
				Effect.annotateLogs({
					workspace: ws.path,
					workspace_created: String(ws.createdNow),
					prompt_length: String(prompt.length),
				}),
			);

			const shouldContinue = () =>
				deps.tracker.fetchIssueStatesByIds([issue.id]).pipe(
					Effect.catchAll(() => Effect.succeed([] as const)),
					Effect.map((result) => {
						const entry = result.find((candidate) => candidate.id === issue.id);
						if (!entry) return false;
						return (
							isDispatchable(entry.state, config) &&
							!isTerminal(entry.state, config)
						);
					}),
				);

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
			const now = Date.now();
			const registered = yield* Deferred.make<void>();

			yield* deps.updateState((s) => {
				const running = new Map(s.running);
				running.set(issue.id, createRunningEntry(issue, ws.path, now));
				return { ...s, running };
			});

			const fiber = yield* Effect.fork(
				Deferred.await(registered).pipe(
					Effect.flatMap(() =>
						deps.agentService.run(agentConfig, abortController.signal).pipe(
							Stream.tap((event) =>
								Effect.all([
									deps.eventPubSub.publish(event),
									deps.enqueueCommand({ _tag: "runtime_event", event }),
								]),
							),
							Stream.runDrain,
						),
					),
					Effect.onExit((exit) =>
						deps.enqueueCommand({
							_tag: "worker_exit",
							issueId: issue.id,
							identifier: issue.identifier,
							attempt,
							config,
							workspacePath: ws.path,
							exit,
						}),
					),
				),
			);

			yield* deps.updateState((s) => {
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

	const processRetry = (
		issueId: string,
		entry: RetryEntry,
	): Effect.Effect<void, never, Scope.Scope> =>
		Effect.gen(function* () {
			yield* takeRetryTimerFiber(issueId);
			yield* deps.updateState((s) => {
				const retryAttempts = new Map(s.retryAttempts);
				retryAttempts.delete(issueId);
				return { ...s, retryAttempts };
			});

			const config = yield* deps.getConfig;
			if (!config) {
				yield* releaseClaim(issueId);
				return;
			}

			const candidates = yield* deps.tracker
				.fetchCandidateIssues(config.dispatchStates as string[])
				.pipe(
					Effect.tapError((e) =>
						Effect.logWarning("tracker_fetch_failed").pipe(
							Effect.annotateLogs({
								operation: "retry_candidates",
								error: String(e),
							}),
						),
					),
					Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<Issue>)),
				);

			const issue = candidates.find((i) => i.id === issueId);
			if (!issue) {
				yield* releaseClaim(issueId);
				yield* Effect.logInfo("retry_issue_gone").pipe(
					Effect.annotateLogs({
						issue_id: issueId,
						identifier: entry.identifier,
					}),
				);
				return;
			}

			const currentState = yield* Ref.get(deps.stateRef);
			if (availableSlots(currentState, config) <= 0) {
				yield* scheduleRetry(
					issueId,
					entry.identifier,
					entry.attempt,
					1_000,
					"no available orchestrator slots",
					"backpressure",
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

	return {
		releaseClaim,
		clearRetryAttempt,
		runAfterRunHook,
		removeRunningEntry,
		scheduleRetry,
		stopRunningIssue,
		handleWorkerExit,
		dispatchIssue,
		processRetry,
	};
}
