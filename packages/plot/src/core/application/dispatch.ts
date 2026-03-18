import {
	Clock,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	PubSub,
	Ref,
	Scope,
	Stream,
	SubscriptionRef,
} from "effect";
import type { AgentRuntimeEvent, Issue, TrackerRunContext } from "@plot/sdk";
import { compilePrompt, compileResearchPrompt } from "../prompt-compiler.js";
import type { ResolvedConfig } from "../config-service.js";
import type { AgentRunConfig } from "../../agent/agent-service.js";
import type {
	OrchestratorCommand,
	WorkerExitCommand,
} from "./orchestrator-command.js";
import { CONTINUATION_DELAY, retryDelay } from "./orchestrator-command.js";
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
import { withTrackerFallback } from "./tracker-fallback.js";

export interface DispatchDeps {
	readonly stateRef: SubscriptionRef.SubscriptionRef<OrchestratorState>;
	readonly retryTimerFibersRef: Ref.Ref<
		Map<string, Fiber.Fiber<void, never>>
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
		readonly fetchRunContext: (
			issueId: string,
			state: string,
		) => Effect.Effect<TrackerRunContext | null, unknown>;
	};
	readonly agentService: {
		readonly run: (
			config: AgentRunConfig,
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
	readonly pluginSkillPaths: ReadonlyArray<string>;
}


const runResearchPhase = Effect.fnUntraced(function* (
	wf: { promptTemplate: string },
	issue: Issue,
	runContext: TrackerRunContext | null,
	workspacePath: string,
	config: ResolvedConfig,
	deps: DispatchDeps,
) {
		const compiled = yield* compileResearchPrompt(
			wf.promptTemplate ||
				"Work the assigned issue using the workflow policy.",
			issue,
			runContext,
		);

		const shouldContinue = () =>
			deps.tracker.fetchIssueStatesByIds([issue.id]).pipe(
				Effect.catch(() => Effect.succeed([] as const)),
				Effect.map((result) => {
					const entry = result.find((c) => c.id === issue.id);
					if (!entry) return false;
					return (
						isDispatchable(entry.state, config) &&
						!isTerminal(entry.state, config)
					);
				}),
			);

		const researchConfig: AgentRunConfig = {
			systemPrompt: compiled.systemPrompt,
			prompt: compiled.userPrompt,
			workspacePath,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
			pluginSkillPaths: deps.pluginSkillPaths,
			maxTurns: Math.min(config.maxTurns, 10),
			turnTimeoutMs: config.turnTimeoutMs,
			stallTimeoutMs: config.stallTimeoutMs,
			modelSpec: config.resolveModelSpec(issue.state),
			shouldContinue,
		};

		const result = yield* deps.agentService.run(researchConfig).pipe(
			Stream.runFold(() => "", (acc, event) =>
				event.event === "message_end" && event.message
					? acc + event.message
					: acc,
			),
		);

		return result || null;
	});

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
		fiber: Fiber.Fiber<void, never>,
	) =>
		Ref.modify(deps.retryTimerFibersRef, (timers) => {
			const next = new Map(timers);
			const previous = next.get(issueId) ?? null;
			next.set(issueId, fiber);
			return [previous, next] as const;
		});

	const clearRetryAttempt = Effect.fnUntraced(function* (issueId: string) {
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

	const removeRunningEntry = Effect.fnUntraced(function* (issueId: string) {
			const now = yield* Clock.currentTimeMillis;
			yield* deps.updateState((s) =>
				removeRunningEntryFromState(s, issueId, now),
			);
		});

	const scheduleRetry = Effect.fnUntraced(function* (
		issueId: string,
		identifier: string,
		attempt: number,
		delay: Duration.Duration,
		error: string | null,
		reason: RetryReason,
	) {
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
				Effect.andThen(
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
		});

	const stopRunningIssue = Effect.fnUntraced(function* (
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

			// Atomic: clearEventLog + bump counter + releaseClaim in one write
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

	const handleWorkerExit = Effect.fnUntraced(function* ({
		issueId,
		identifier,
		attempt,
		config,
		workspacePath,
		exit,
	}: WorkerExitCommand) {
			const now = yield* Clock.currentTimeMillis;
			const exitReason: "success" | "interrupted" | "failure" = Exit.isSuccess(
				exit,
			)
				? "success"
				: Exit.hasInterrupts(exit)
					? "interrupted"
					: "failure";

			const exitErrorString: string | null =
				exitReason === "failure" && Exit.isFailure(exit)
					? String(exit.cause)
					: null;

			yield* deps.updateState((s) => {
				const runningEntry = s.running.get(issueId) ?? null;
				const after = removeRunningEntryFromState(s, issueId, now);
				const issueArtifacts = new Map(after.issueArtifacts);
				const previousArtifact = issueArtifacts.get(issueId);
				issueArtifacts.set(issueId, {
					issueId,
					issueIdentifier: identifier,
					workspacePath:
						runningEntry?.workspacePath ??
						previousArtifact?.workspacePath ??
						workspacePath,
					promptSnapshot:
						runningEntry?.promptSnapshot ??
						previousArtifact?.promptSnapshot ??
						null,
					runContext:
						runningEntry?.runContext ?? previousArtifact?.runContext ?? null,
					lastError: exitErrorString,
				});
				return {
					...after,
					issueArtifacts,
					workerExitsByReason: {
						...after.workerExitsByReason,
						[exitReason]: after.workerExitsByReason[exitReason] + 1,
					},
				};
			});

			yield* runAfterRunHook(config, workspacePath);

			if (exitReason === "success") {
				yield* scheduleRetry(
					issueId,
					identifier,
					1,
					CONTINUATION_DELAY,
					null,
					"continuation",
				);
			} else if (exitReason === "interrupted") {
				yield* releaseClaim(issueId);
				yield* Effect.logInfo("worker_interrupted").pipe(
					Effect.annotateLogs({ issue_id: issueId, identifier }),
				);
			} else {
				const error = exitErrorString ?? "unknown";
				const isStall = error.includes("runner_stalled");
				yield* Effect.logError(isStall ? "agent_stalled" : "agent_failed").pipe(
					Effect.annotateLogs({ issue_id: issueId, identifier, error }),
				);
				const nextAttempt = (attempt ?? 0) + 1;
				yield* scheduleRetry(
					issueId,
					identifier,
					nextAttempt,
					retryDelay(nextAttempt, config.maxRetryBackoffMs),
					isStall
						? `Previous attempt stalled (no output). The task may need to be broken into smaller pieces. Original error: ${error}`
						: error,
					isStall ? "stall" : "failure",
				);
			}
		});

	const dispatchIssue = (
		issue: Issue,
		config: ResolvedConfig,
		attempt: number | null,
	) =>
		Effect.gen(function* () {
			// --- Phase 1: all fallible work, no state mutations ---
			const ws = yield* deps.workspaceManager.ensureWorkspace(
				issue.identifier,
				config,
			);

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

			let researchReport: string | null = null;
			if (config.researchAgent && attempt === null) {
				researchReport = yield* runResearchPhase(
					wf,
					issue,
					runContext,
					ws.path,
					config,
					deps,
				).pipe(
					Effect.catch((e) =>
						Effect.logWarning("research_phase_failed").pipe(
							Effect.annotateLogs({ error: String(e) }),
							Effect.map(() => null as string | null),
						),
					),
					Effect.timeout(Duration.millis(config.stallTimeoutMs)),
				);
			}

			const compiled = yield* compilePrompt(
				wf.promptTemplate ||
					"Work the assigned issue using the workflow policy.",
				issue,
				attempt,
				runContext,
				researchReport,
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

			const shouldContinue = () =>
				deps.tracker.fetchIssueStatesByIds([issue.id]).pipe(
					Effect.catch(() => Effect.succeed([] as const)),
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
				systemPrompt: compiled.systemPrompt,
				prompt: compiled.userPrompt,
				workspacePath: ws.path,
				issueId: issue.id,
				issueIdentifier: issue.identifier,
				pluginSkillPaths: deps.pluginSkillPaths,
				maxTurns: config.maxTurns,
				turnTimeoutMs: config.turnTimeoutMs,
				stallTimeoutMs: config.stallTimeoutMs,
				modelSpec: config.resolveModelSpec(issue.state),
				shouldContinue,
			};

			// --- Phase 2: fork worker ---
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

			// --- Phase 3: ONE atomic state write ---
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
						promptSnapshot: compiled.snapshot,
						runContext,
					}),
				);
				const issueArtifacts = new Map(s.issueArtifacts);
				issueArtifacts.set(issue.id, {
					issueId: issue.id,
					issueIdentifier: issue.identifier,
					workspacePath: ws.path,
					promptSnapshot: compiled.snapshot,
					runContext,
					lastError: null,
				});
				return { ...s, claimed, retryAttempts, running, issueArtifacts };
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

	const processRetry = Effect.fnUntraced(function* (
		issueId: string,
		entry: RetryEntry,
	) {
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

			const currentState = yield* SubscriptionRef.get(deps.stateRef);
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
