import { Clock, Deferred, Duration, Effect, Exit, Fiber, PubSub, Ref, Scope, Stream } from "effect";
import type { AgentRuntimeEvent, Issue, TrackerError, TrackerRunContext } from "@plot/sdk";
import { compilePrompt } from "../prompt-compiler.js";
import type { ResolvedConfig } from "../config-service.js";
import type { AgentRunConfig } from "../../agent/agent-service.js";
import type { OrchestratorCommand, WorkerExitCommand } from "./orchestrator-command.js";
import { CONTINUATION_DELAY, retryDelay } from "./orchestrator-command.js";
import {
	availableSlots,
	clearEventLog,
	clearRetryAttemptFromState,
	createRunningEntry,
	removeRunningEntryFromState,
	releaseClaimFromState,
	type OrchestratorState,
	type RetryEntry,
	type RetryReason,
	type RunningEntry,
} from "../domain/orchestrator-state.js";
const MERGE_CONFLICT_INSTRUCTION =
	"A previous attempt at this task resulted in merge conflicts. " +
	"Please try implementing the task again from scratch on a clean branch.";
import { withTrackerFallback } from "./tracker-fallback.js";

export interface DispatchDeps {
	readonly getState: Effect.Effect<OrchestratorState>;
	readonly retryTimerFibersRef: Ref.Ref<Map<string, Fiber.Fiber<void, never>>>;
	readonly workflowLoader: {
		readonly getCurrent: Effect.Effect<{ promptTemplate: string } | null>;
	};
	readonly tracker: {
		readonly fetchCandidateIssues: (
			states: string[],
		) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;
		readonly fetchIssueStatesByIds: (
			ids: readonly string[],
		) => Effect.Effect<ReadonlyArray<{ id: string; state: string }>, TrackerError>;
		readonly fetchRunContext: (
			issueId: string,
			state: string,
		) => Effect.Effect<TrackerRunContext | null, TrackerError>;
	};
	readonly agentService: {
		readonly run: (config: AgentRunConfig) => Stream.Stream<AgentRuntimeEvent, unknown>;
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
	readonly updateState: (fn: (s: OrchestratorState) => OrchestratorState) => Effect.Effect<void>;
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

	const replaceRetryTimerFiber = (issueId: string, fiber: Fiber.Fiber<void, never>) =>
		Ref.modify(deps.retryTimerFibersRef, (timers) => {
			const next = new Map(timers);
			const previous = next.get(issueId) ?? null;
			next.set(issueId, fiber);
			return [previous, next] as const;
		});

	const clearRetryAttempt = Effect.fn("DispatchRuntime.clearRetryAttempt")(function* (issueId: string) {
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
						Effect.catch((e) =>
							Effect.logWarning("after_run_hook_failed").pipe(
								Effect.annotateLogs({ error: String(e) }),
							),
						),
					)
			: Effect.void;


	const scheduleRetry = Effect.fn("DispatchRuntime.scheduleRetry")(function* (
		issueId: string,
		identifier: string,
		attempt: number,
		delay: Duration.Duration,
		error: string | null,
		reason: RetryReason,
	) {
		yield* clearRetryAttempt(issueId);

		const now = yield* Clock.currentTimeMillis;
		const dueAtMs = now + Duration.toMillis(delay);
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
				delay_ms: String(Duration.toMillis(delay)),
				error: error ?? "continuation",
				reason,
			}),
		);

		const timerFiber = yield* Effect.sleep(delay).pipe(
			Effect.andThen(deps.enqueueCommand({ _tag: "retry_due", issueId, attempt })),
			Effect.forkScoped,
		);
		yield* replaceRetryTimerFiber(issueId, timerFiber).pipe(
			Effect.flatMap((previous) => (previous ? Fiber.interrupt(previous) : Effect.void)),
		);
	});

	const stopRunningIssue = Effect.fn("DispatchRuntime.stopRunningIssue")(function* (
		entry: RunningEntry,
		config: ResolvedConfig,
		options: {
			readonly reason: "terminal" | "inactive" | "stalled";
			readonly removeWorkspace: boolean;
			readonly releaseClaim: boolean;
			readonly log: Record<string, string>;
		},
	) {
		if (entry.fiber) {
			yield* Fiber.interrupt(entry.fiber);
		}
		if (options.removeWorkspace) {
			yield* deps.workspaceManager
				.removeWorkspace(entry.issueIdentifier, config)
				.pipe(Effect.ignore);
		}
		yield* clearRetryAttempt(entry.issueId);

		yield* deps.updateState((s) => {
			let next = s;
			if (options.reason === "terminal") {
				next = clearEventLog(next, entry.issueId);
			}
			next = {
				...next,
				workerStopsByReason: {
					...next.workerStopsByReason,
					[options.reason]: next.workerStopsByReason[options.reason] + 1,
				},
			};
			if (options.releaseClaim) {
				next = releaseClaimFromState(next, entry.issueId);
			}
			return next;
		});

		yield* Effect.logInfo("worker_stopped").pipe(
			Effect.annotateLogs({
				issue_id: entry.issueId,
				identifier: entry.issueIdentifier,
				stop_reason: options.reason,
				...options.log,
			}),
		);
	});

	const handleWorkerExit = Effect.fn("DispatchRuntime.handleWorkerExit")(function* ({
		issueId,
		identifier,
		attempt,
		config,
		workspacePath,
		exit,
	}: WorkerExitCommand) {
		const now = yield* Clock.currentTimeMillis;
		const exitReason: "success" | "interrupted" | "failure" = Exit.isSuccess(exit)
			? "success"
			: Exit.hasInterrupts(exit)
				? "interrupted"
				: "failure";

		const exitErrorString: string | null =
			exitReason === "failure" && Exit.isFailure(exit) ? String(exit.cause) : null;

		yield* deps.updateState((s) => {
			const after = removeRunningEntryFromState(s, issueId, now);
			return {
				...after,
				workerExitsByReason: {
					...after.workerExitsByReason,
					[exitReason]: after.workerExitsByReason[exitReason] + 1,
				},
			};
		});

		yield* runAfterRunHook(config, workspacePath);

		yield* Effect.gen(function* () {
			if (exitReason === "success") {
				yield* scheduleRetry(issueId, identifier, 1, CONTINUATION_DELAY, null, "continuation");
			} else if (exitReason === "interrupted") {
				yield* releaseClaim(issueId);
				yield* Effect.logInfo("worker_interrupted").pipe(
					Effect.annotateLogs({ issue_id: issueId, identifier }),
				);
			} else {
				const error = exitErrorString ?? "unknown";
				const isStall = error.includes("runner_stalled");
				const isMergeConflict =
					error.includes("merge conflict") ||
					error.includes("CONFLICT") ||
					error.includes("rebase --abort");
				yield* Effect.logError(
					isStall ? "agent_stalled" : isMergeConflict ? "merge_conflict" : "agent_failed",
				).pipe(Effect.annotateLogs({ issue_id: issueId, identifier, error }));
				const nextAttempt = (attempt ?? 0) + 1;
				const retryError = isStall
					? `Previous attempt stalled (no output). The task may need to be broken into smaller pieces. Original error: ${error}`
					: isMergeConflict
						? `${MERGE_CONFLICT_INSTRUCTION} Original error: ${error}`
						: error;
				yield* scheduleRetry(
					issueId,
					identifier,
					nextAttempt,
					retryDelay(nextAttempt, config.maxRetryBackoffMs),
					retryError,
					isStall ? "stall" : isMergeConflict ? "merge_conflict" : "failure",
				);
			}
		}).pipe(
			Effect.catchCause((cause) =>
				Effect.logError("worker_exit_handling_failed").pipe(
					Effect.annotateLogs({
						issue_id: issueId,
						identifier,
						error: String(cause),
					}),
					Effect.andThen(releaseClaim(issueId)),
				),
			),
		);
	});

	const dispatchIssue: (
		issue: Issue,
		config: ResolvedConfig,
		attempt: number | null,
	) => Effect.Effect<void, unknown, Scope.Scope> = Effect.fn("DispatchRuntime.dispatchIssue")(function* (
		issue: Issue,
		config: ResolvedConfig,
		attempt: number | null,
	) {
			const ws = yield* deps.workspaceManager.ensureWorkspace(issue.identifier, config);

			if (config.hooksBeforeRun) {
				yield* deps.workspaceManager
					.runHook(config.hooksBeforeRun, ws.path, config.hooksTimeoutMs)
					.pipe(Effect.tapError(() => runAfterRunHook(config, ws.path)));
			}

			const wf = yield* deps.workflowLoader.getCurrent;
			if (!wf) return;

			const runContext = yield* deps.tracker
				.fetchRunContext(issue.id, issue.state)
				.pipe(Effect.catch(() => Effect.succeed(null)));

			const compiled = yield* compilePrompt(
				wf.promptTemplate || "Work the assigned issue using the workflow policy.",
				issue,
				attempt,
				runContext,
			).pipe(Effect.tapError(() => runAfterRunHook(config, ws.path)));

			yield* Effect.logInfo("dispatch").pipe(
				Effect.annotateLogs({
					workspace: ws.path,
					workspace_created: String(ws.createdNow),
					system_prompt_length: String(compiled.systemPrompt.length),
					user_prompt_length: String(compiled.userPrompt.length),
					stable_prefix_hash: compiled.snapshot.stablePrefixHash,
				}),
			);

			const agentConfig: AgentRunConfig = {
				systemPrompt: compiled.systemPrompt,
				prompt: compiled.userPrompt,
				workspacePath: ws.path,
				issueId: issue.id,
				issueIdentifier: issue.identifier,
				maxTurns: config.maxTurns,
				turnTimeoutMs: config.turnTimeoutMs,
				stallTimeoutMs: config.stallTimeoutMs,
				modelSpec: config.resolveModelSpec(issue.state, issue.labels),
			};

			const now = yield* Clock.currentTimeMillis;
			const registered = yield* Deferred.make<void>();

			const fiber = yield* Effect.forkScoped(
				Deferred.await(registered).pipe(
					Effect.flatMap(() =>
						deps.agentService.run(agentConfig).pipe(
							Stream.tap((event) =>
								Effect.all([
									PubSub.publish(deps.eventPubSub, event),
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
				const claimed = new Set(s.claimed);
				claimed.add(issue.id);
				const retryAttempts = new Map(s.retryAttempts);
				retryAttempts.delete(issue.id);
				const running = new Map(s.running);
				running.set(
					issue.id,
					createRunningEntry(issue, ws.path, now, {
						fiber,
					}),
				);
				return { ...s, claimed, retryAttempts, running };
			});

			yield* Deferred.succeed(registered, undefined);
			yield* Effect.annotateCurrentSpan({
				issue_id: issue.id,
				identifier: issue.identifier,
				state: issue.state,
				priority: String(issue.priority ?? -1),
			});
		}
	);

	const processRetry: (
		issueId: string,
		entry: RetryEntry,
	) => Effect.Effect<void, unknown, Scope.Scope> = Effect.fn("DispatchRuntime.processRetry")(function* (issueId: string, entry: RetryEntry) {
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

		const candidates = yield* withTrackerFallback(
			deps.tracker.fetchCandidateIssues(config.dispatchStates as string[]),
			"retry_candidates",
			[] as ReadonlyArray<Issue>,
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

		const currentState = yield* deps.getState;
		if (availableSlots(currentState, config) <= 0) {
			yield* scheduleRetry(
				issueId,
				entry.identifier,
				entry.attempt,
				Duration.seconds(1),
				"no available orchestrator slots",
				"backpressure",
			);
			return;
		}

		yield* dispatchIssue(issue, config, entry.attempt).pipe(
			Effect.catch((e) =>
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
		stopRunningIssue,
		handleWorkerExit,
		dispatchIssue,
		processRetry,
	};
}
