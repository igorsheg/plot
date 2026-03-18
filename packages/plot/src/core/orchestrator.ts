import {
	Clock,
	Config,
	Duration,
	Effect,
	Fiber,
	Mailbox,
	Match,
	Option,
	PubSub,
	Ref,
	ServiceMap,
	Stream,
	SubscriptionRef,
} from "effect";
import { type AgentRuntimeEvent, TrackerClient } from "@plot/sdk";
import { ResolvedConfig } from "./config-service.js";
import { AgentService } from "../agent/agent-service.js";
import { WorkflowLoader } from "./workflow-loader.js";
import { WorkspaceManager } from "./workspace-manager.js";
import { WorkflowOverridesConfig } from "../config.js";
import {
	COMMAND_QUEUE_CAPACITY,
	COMMAND_QUEUE_PRESSURE_WARN_AT,
	type OrchestratorCommand,
} from "./application/orchestrator-command.js";
import { makeDispatchRuntime } from "./application/dispatch.js";
import { makeTickRuntime } from "./application/reconcile.js";
import { PluginContext } from "./plugin-context.js";
import {
	incrementCommandQueuePressureInState,
	initialState,
	consumeRuntimeEvent,
	noteCommandQueueSizeInState,
	type OrchestratorState,
} from "./domain/orchestrator-state.js";

export class Orchestrator extends ServiceMap.Service<Orchestrator>()(
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
			const pluginContext = yield* PluginContext;
			const commandMailbox = yield* Mailbox.make<OrchestratorCommand>({
				capacity: COMMAND_QUEUE_CAPACITY,
			});

			const overrides = yield* WorkflowOverridesConfig.pipe(
				Config.nested("PLOT"),
			);

			const configRef = yield* SubscriptionRef.make<ResolvedConfig | null>(
				null,
			);

			const getState = Ref.get(stateRef);

			const getConfig = Ref.get(configRef);

			const updateState = (fn: (s: OrchestratorState) => OrchestratorState) =>
				Ref.update(stateRef, fn);

			const incrementCommandQueuePressure = (queueSize: number) =>
				updateState((s) => incrementCommandQueuePressureInState(s, queueSize));

			const noteCommandQueueSize = (queueSize: number) =>
				updateState((s) => noteCommandQueueSizeInState(s, queueSize));

			const getCommandQueueDepth = commandMailbox.size.pipe(
				Effect.map(Option.getOrElse(() => 0)),
			);

			const enqueueCommand = Effect.fnUntraced(function* (
				command: OrchestratorCommand,
			) {
				const queueSize = yield* commandMailbox.size.pipe(
					Effect.map(Option.getOrElse(() => 0)),
				);
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
				yield* commandMailbox.offer(command);
			});

			const requestTick = Effect.fnUntraced(function* (
				reason: string,
				options?: { readonly coalesce?: boolean },
			) {
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

			const consumeEvent = Effect.fnUntraced(function* (
				event: AgentRuntimeEvent,
			) {
				const now = yield* Clock.currentTimeMillis;
				yield* updateState((s) => consumeRuntimeEvent(s, event, now));
			});

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
				pluginSkillPaths: pluginContext.skillPaths,
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

			const handleCommand = (command: OrchestratorCommand) =>
				Match.value(command).pipe(
					Match.discriminator("_tag")(
						"tick",
						Effect.fnUntraced(function* (cmd) {
							if (cmd.coalesced) {
								yield* Ref.set(pendingPollTickRef, false);
							}
							yield* tickRuntime.runTick.pipe(
								Effect.catchAll((e) =>
									Effect.logError("tick_failed").pipe(
										Effect.annotateLogs({
											reason: cmd.reason,
											error: String(e),
										}),
									),
								),
							);
						}),
					),
					Match.discriminator("_tag")("runtime_event", (cmd) =>
						consumeEvent(cmd.event),
					),
					Match.discriminator("_tag")("retry_due", (cmd) =>
						tickRuntime.handleRetryDue(cmd),
					),
					Match.discriminator("_tag")("worker_exit", (cmd) =>
						dispatchRuntime.handleWorkerExit(cmd).pipe(
							Effect.catchAll((e) =>
								Effect.logError("worker_exit_failed").pipe(
									Effect.annotateLogs({
										issue_id: cmd.issueId,
										error: String(e),
									}),
								),
							),
						),
					),
					Match.exhaustive,
				);

			const commandLoop = Effect.gen(function* () {
				while (true) {
					const command = yield* commandMailbox.take;
					const queueSize = yield* commandMailbox.size.pipe(
						Effect.map(Option.getOrElse(() => 0)),
					);
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
					yield* handleCommand(command);
				}
			});

			const pollLoop = Effect.gen(function* () {
				const config = yield* getConfig;
				const interval = config?.pollIntervalMs ?? 30_000;
				yield* requestTick("poll", { coalesce: true });
				yield* Effect.sleep(`${interval} millis`);
			}).pipe(Effect.forever);

			const syncConfig = Effect.gen(function* () {
				const wf = yield* workflowLoader.getCurrent;
				if (!wf) return;
				const resolved = new ResolvedConfig(wf.config, overrides);
				yield* Ref.set(configRef, resolved);
			});

			const start = Effect.fnUntraced(function* (workflowPath: string) {
				yield* workflowLoader
					.load(workflowPath)
					.pipe(Effect.catchAll((e) => Effect.die(e)));

				yield* syncConfig;

				const config = yield* getConfig;

				yield* Effect.logInfo("orchestrator_started").pipe(
					Effect.annotateLogs({ workflow: workflowPath }),
				);

				if (config) {
					yield* tickRuntime.startupTerminalCleanup(config);
				}

				yield* workflowLoader.startWatching(workflowPath);

				const configWatchLoop = syncConfig.pipe(
					Effect.delay(Duration.seconds(5)),
					Effect.forever,
					Effect.forkScoped,
				);
				yield* configWatchLoop;

				yield* Effect.forkScoped(commandLoop);
				yield* Effect.forkScoped(pollLoop);
				yield* requestTick("startup");
			});

			const tick = requestTick("manual");

			const eventStream = Stream.fromPubSub(eventPubSub);
			const stateStream = stateRef.changes;
			const configStream = configRef.changes;

			return {
				start,
				tick,
				getState,
				getConfig,
				getCommandQueueDepth,
				eventStream,
				stateStream,
				configStream,
			};
		}),
		dependencies: [WorkflowLoader.Default, WorkspaceManager.Default],
	},
) {}
