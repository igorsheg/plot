import { Effect, Ref, type Scope } from "effect";
import type { Issue } from "@plot/sdk";
import { validateForDispatch, type ResolvedConfig } from "../config-service.js";
import {
	incrementStaleRetryDropCount,
	isActive,
	isEligible,
	isTerminal,
	sortCandidates,
	type OrchestratorState,
	type RetryEntry,
} from "../domain/orchestrator-state.js";
import type { OrchestratorCommand } from "./orchestrator-command.js";

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
	readonly updateState: (
		fn: (s: OrchestratorState) => OrchestratorState,
	) => Effect.Effect<void>;
	readonly stopRunningIssue: (
		entry: OrchestratorState["running"] extends Map<string, infer R>
			? R
			: never,
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
	const reconcile = (config: ResolvedConfig) =>
		Effect.gen(function* () {
			const state = yield* Ref.get(deps.stateRef);
			const runningIds = [...state.running.keys()];
			if (runningIds.length === 0) return;

			const stateEntries = yield* deps.tracker
				.fetchIssueStatesByIds(runningIds)
				.pipe(
					Effect.tapError((e) =>
						Effect.logWarning("tracker_fetch_failed").pipe(
							Effect.annotateLogs({
								operation: "reconcile_states",
								error: String(e),
							}),
						),
					),
					Effect.catchAll(() => Effect.succeed([] as const)),
				);

			const stateMap = new Map(stateEntries.map((e) => [e.id, e.state]));
			let stoppedCount = 0;

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

				if (currentState && !isActive(currentState, config)) {
					yield* deps.stopRunningIssue(entry, config, {
						reason: "inactive",
						removeWorkspace: false,
						releaseClaim: true,
						log: { issue_state: currentState },
					});
					stoppedCount++;
					continue;
				}

				if (currentState) {
					yield* deps.updateState((s) => {
						const running = new Map(s.running);
						const existing = running.get(issueId);
						if (existing)
							running.set(issueId, { ...existing, state: currentState });
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

	const startupTerminalCleanup = (config: ResolvedConfig) =>
		Effect.gen(function* () {
			const terminalIssues = yield* deps.tracker
				.fetchIssuesByStates(config.terminalStates as string[])
				.pipe(
					Effect.tapError((e) =>
						Effect.logWarning("tracker_fetch_failed").pipe(
							Effect.annotateLogs({
								operation: "startup_cleanup",
								error: String(e),
							}),
						),
					),
					Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<Issue>)),
				);

			let cleanedCount = 0;
			for (const issue of terminalIssues) {
				yield* deps
					.removeWorkspace(issue.identifier, config)
					.pipe(Effect.ignore);
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
			Effect.catchAll((e) =>
				Effect.logError("dispatch_validation_failed").pipe(
					Effect.annotateLogs({ error: e.message }),
				),
			),
		);

		const candidates = yield* deps.tracker
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
			const currentState = yield* Ref.get(deps.stateRef);
			if (!isEligible(issue, currentState, config)) continue;
			yield* deps.dispatchIssue(issue, config, null).pipe(
				Effect.catchAll((e) =>
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

	const handleRetryDue = (
		command: Extract<OrchestratorCommand, { _tag: "retry_due" }>,
	) =>
		Effect.gen(function* () {
			const retryEntry = (yield* Ref.get(deps.stateRef)).retryAttempts.get(
				command.issueId,
			);
			if (!retryEntry) {
				yield* deps.updateState(incrementStaleRetryDropCount);
				return;
			}
			if (retryEntry.attempt !== command.attempt) {
				yield* deps.updateState(incrementStaleRetryDropCount);
				return;
			}
			if (retryEntry.dueAtMs > Date.now()) {
				yield* deps.updateState(incrementStaleRetryDropCount);
				return;
			}

			yield* deps.processRetry(command.issueId, retryEntry).pipe(
				Effect.catchAll((e) =>
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
