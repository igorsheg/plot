import {
	Effect,
	Ref,
	Stream,
	PubSub,
	Queue,
	SubscriptionRef,
	Fiber,
} from "effect";
import type { AgentRuntimeEvent } from "@plot/contracts";
import { ResolvedConfig } from "./config-service.js";
import {
	AgentService,
	TrackerClient,
	WorkflowLoader,
	WorkspaceManager,
} from "./ports.js";
import {
	COMMAND_QUEUE_CAPACITY,
	COMMAND_QUEUE_PRESSURE_WARN_AT,
	type OrchestratorCommand,
} from "./application/orchestrator-command.js";
import { makeDispatchRuntime } from "./application/dispatch.js";
import { makeTickRuntime } from "./application/reconcile.js";
import {
	incrementCommandQueuePressureInState,
	initialState,
	consumeRuntimeEvent,
	noteCommandQueueSizeInState,
	type OrchestratorState,
} from "./domain/orchestrator-state.js";

// ---------------------------------------------------------------------------
// orchestrator service
// ---------------------------------------------------------------------------

export class Orchestrator extends Effect.Service<Orchestrator>()(
	"Orchestrator",
	{
		effect: Effect.gen(function* () {
			const stateRef =
				yield* SubscriptionRef.make<OrchestratorState>(initialState);
			const pendingPollTickRef = yield* Ref.make(false);
			const retryTimerFibersRef = yield* Ref.make(
				new Map<string, Fiber.RuntimeFiber<void, never>>(),
			);
			const workflowLoader = yield* WorkflowLoader;
			const tracker = yield* TrackerClient;
			const agentService = yield* AgentService;
			const workspaceManager = yield* WorkspaceManager;
			const eventPubSub = yield* PubSub.bounded<AgentRuntimeEvent>(512);
			const commandQueue = yield* Queue.bounded<OrchestratorCommand>(
				COMMAND_QUEUE_CAPACITY,
			);

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

			const incrementCommandQueuePressure = (queueSize: number) =>
				updateState((s) => incrementCommandQueuePressureInState(s, queueSize));

			const noteCommandQueueSize = (queueSize: number) =>
				updateState((s) => noteCommandQueueSizeInState(s, queueSize));

			const enqueueCommand = (command: OrchestratorCommand) =>
				Effect.gen(function* () {
					const queueSize = yield* Queue.size(commandQueue);
					yield* noteCommandQueueSize(queueSize);
					if (queueSize >= COMMAND_QUEUE_PRESSURE_WARN_AT) {
						yield* incrementCommandQueuePressure(queueSize);
						yield* Effect.logWarning("command_queue_pressure").pipe(
							Effect.annotateLogs({
								queue_size: String(queueSize),
								queue_capacity: String(COMMAND_QUEUE_CAPACITY),
								command_type: command._tag,
							}),
						);
					}
					yield* Queue.offer(commandQueue, command);
				}).pipe(Effect.asVoid);

			const requestTick = (
				reason: string,
				options?: { readonly coalesce?: boolean },
			) =>
				Effect.gen(function* () {
					if (options?.coalesce) {
						const shouldEnqueue = yield* Ref.modify(
							pendingPollTickRef,
							(pending) => (pending ? [false, pending] : [true, true]),
						);
						if (!shouldEnqueue) return;
					}
					yield* enqueueCommand({
						_tag: "tick",
						reason,
						coalesced: options?.coalesce ?? false,
					});
				});

			const getCommandQueueDepth = Queue.size(commandQueue);

			// -----------------------------------------------------------------------
			// event consumption — updates running entry from agent events
			// -----------------------------------------------------------------------

			const consumeEvent = (event: AgentRuntimeEvent) =>
				updateState((s) => consumeRuntimeEvent(s, event));

			// -----------------------------------------------------------------------
			// retry scheduling — single scheduler fiber, wake-on-insert
			// -----------------------------------------------------------------------

			const dispatchRuntime = makeDispatchRuntime({
				stateRef,
				retryTimerFibersRef,
				workflowLoader,
				tracker,
				agentService,
				workspaceManager,
				eventPubSub,
				enqueueCommand,
				getConfig,
				updateState,
			});

			const tickRuntime = makeTickRuntime({
				stateRef,
				tracker,
				removeWorkspace: (identifier, config) =>
					workspaceManager.removeWorkspace(identifier, config),
				getConfig,
				updateState,
				stopRunningIssue: dispatchRuntime.stopRunningIssue,
				processRetry: dispatchRuntime.processRetry,
				dispatchIssue: dispatchRuntime.dispatchIssue,
			});

			const commandLoop = Effect.gen(function* () {
				while (true) {
					const command = yield* Queue.take(commandQueue);
					const queueSize = yield* Queue.size(commandQueue);
					yield* noteCommandQueueSize(queueSize);
					if (queueSize >= COMMAND_QUEUE_PRESSURE_WARN_AT) {
						yield* Effect.logWarning("command_queue_backlog").pipe(
							Effect.annotateLogs({
								queue_size: String(queueSize),
								queue_capacity: String(COMMAND_QUEUE_CAPACITY),
								command_type: command._tag,
							}),
						);
					}

					if (command._tag === "tick") {
						if (command.coalesced) {
							yield* Ref.set(pendingPollTickRef, false);
						}
						yield* tickRuntime.runTick.pipe(
							Effect.catchAll((e) =>
								Effect.logError("tick_failed").pipe(
									Effect.annotateLogs({
										reason: command.reason,
										error: String(e),
									}),
								),
							),
						);
						continue;
					}

					if (command._tag === "runtime_event") {
						yield* consumeEvent(command.event);
						continue;
					}

					if (command._tag === "retry_due") {
						yield* tickRuntime.handleRetryDue(command);
						continue;
					}

					yield* dispatchRuntime.handleWorkerExit(command).pipe(
						Effect.catchAll((e) =>
							Effect.logError("worker_exit_failed").pipe(
								Effect.annotateLogs({
									issue_id: command.issueId,
									error: String(e),
								}),
							),
						),
					);
				}
			});

			// -----------------------------------------------------------------------
			// poll loop
			// -----------------------------------------------------------------------

			const pollLoop: Effect.Effect<never> = Effect.gen(function* () {
				while (true) {
					const config = yield* getConfig;
					const interval = config?.pollIntervalMs ?? 30_000;
					yield* Effect.sleep(`${interval} millis`);
					yield* requestTick("poll", { coalesce: true });
				}
			});

			// -----------------------------------------------------------------------
			// start
			// -----------------------------------------------------------------------

			const start = (workflowPath: string) =>
				Effect.gen(function* () {
					yield* workflowLoader
						.load(workflowPath)
						.pipe(Effect.catchAll((e) => Effect.die(e)));

					const config = yield* getConfig;

					yield* Effect.logInfo("orchestrator_started").pipe(
						Effect.annotateLogs({ workflow: workflowPath }),
					);

					if (config) {
						yield* tickRuntime.startupTerminalCleanup(config);
					}

					yield* workflowLoader.startWatching(workflowPath);

					yield* Effect.forkScoped(commandLoop);
					yield* Effect.forkScoped(pollLoop);
					yield* requestTick("startup");
				});

			const tick = requestTick("manual");

			const eventStream = Stream.fromPubSub(eventPubSub);
			const stateStream = stateRef.changes;

			return {
				start,
				tick,
				getState,
				getConfig,
				getCommandQueueDepth,
				eventStream,
				stateStream,
			};
		}),
		dependencies: [WorkflowLoader.Default, WorkspaceManager.Default],
	},
) {}
