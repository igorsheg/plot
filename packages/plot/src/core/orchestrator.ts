import {
	Clock,
	Config,
	DateTime,
	Duration,
	Effect,
	Fiber,
	Layer,
	Match,
	PubSub,
	Queue,
	Ref,
	ServiceMap,
	Stream,
} from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import {
	type AgentRuntimeEvent,
	IssueEventLog,
	IssueNotFound,
	OrchestratorUnavailable,
	RefreshResult,
	RetryEntry,
	RunningEntry,
	RuntimeObservability,
	RuntimeSnapshot,
	TokenTotals,
	ToolExecution,
	TrackerClient,
	LiveSession,
} from "@plot/sdk";
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
import {
	incrementCommandQueuePressureInState,
	initialState,
	consumeRuntimeEvent,
	noteCommandQueueSizeInState,
	type OrchestratorState,
} from "./domain/orchestrator-state.js";

const parseSessionId = (sid: string | null) => {
	if (!sid) return { threadId: "", turnId: "" };
	const idx = sid.lastIndexOf("-");
	if (idx === -1) return { threadId: sid, turnId: "" };
	return { threadId: sid.slice(0, idx), turnId: sid.slice(idx + 1) };
};

const mapRunningEntry = (r: {
	issueId: string;
	issueIdentifier: string;
	state: string;
	startedAt: number;
	workspacePath: string;
	sessionId: string | null;
	lastEventAt: number;
	lastMessage: string | null;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	turnCount: number;
	phase?: "idle" | "thinking" | "tool_execution" | "compacting" | "retrying";
	activeTools?: ReadonlyArray<{ toolCallId: string; toolName: string }>;
	lastAssistantMessage?: string | null;
}) => {
	const { threadId, turnId } = parseSessionId(r.sessionId);
	return new RunningEntry({
		issueId: r.issueId,
		issueIdentifier: r.issueIdentifier,
		state: r.state,
		startedAt: DateTime.fromDateUnsafe(new Date(r.startedAt)),
		workspacePath: r.workspacePath,
		session: new LiveSession({
			sessionId: r.sessionId ?? "",
			threadId,
			turnId,
			agentPid: null,
			lastEvent: null,
			lastEventAt: r.lastEventAt ? DateTime.fromDateUnsafe(new Date(r.lastEventAt)) : null,
			lastMessage: r.lastMessage,
			inputTokens: r.inputTokens,
			outputTokens: r.outputTokens,
			totalTokens: r.totalTokens,
			turnCount: r.turnCount,
			phase: r.phase ?? "idle",
			activeTools: (r.activeTools ?? []).map((t) => new ToolExecution(t)),
			lastAssistantMessage: r.lastAssistantMessage ?? null,
		}),
	});
};

const mapRetryEntry = (r: {
	issueId: string;
	identifier: string;
	attempt: number;
	dueAtMs: number;
	error: string | null;
}) =>
	new RetryEntry({
		issueId: r.issueId,
		identifier: r.identifier,
		attempt: r.attempt,
		dueAt: DateTime.fromDateUnsafe(new Date(r.dueAtMs)),
		error: r.error,
	});

const withOrchestratorAvailability = <A, E>(
	effect: Effect.Effect<A, E>,
): Effect.Effect<A, OrchestratorUnavailable> =>
	effect.pipe(
		Effect.mapError(
			() =>
				new OrchestratorUnavailable({
					message: "Orchestrator state is unavailable",
				}),
		),
	);

const mapRuntimeSnapshot = (state: {
	running: Map<string, Parameters<typeof mapRunningEntry>[0]>;
	retryAttempts: Map<string, Parameters<typeof mapRetryEntry>[0]>;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalTokens: number;
	endedSessionSeconds: number;
	commandQueueDepth: number;
	commandQueuePeak: number;
	commandQueuePressureCount: number;
	staleRetryDropCount: number;
	retriesScheduledByReason: {
		continuation: number;
		failure: number;
		backpressure: number;
	};
	workerStopsByReason: {
		terminal: number;
		inactive: number;
		stalled: number;
	};
	workerExitsByReason: {
		success: number;
		interrupted: number;
		failure: number;
	};
}) => {
	const running = [...state.running.values()].map(mapRunningEntry);
	const retrying = [...state.retryAttempts.values()].map(mapRetryEntry);
	const now = Date.now();
	const activeSeconds = [...state.running.values()].reduce(
		(acc, r) => acc + (now - r.startedAt) / 1000,
		0,
	);

	return new RuntimeSnapshot({
		generatedAt: DateTime.nowUnsafe(),
		counts: { running: running.length, retrying: retrying.length },
		running,
		retrying,
		codexTotals: new TokenTotals({
			inputTokens: state.totalInputTokens,
			outputTokens: state.totalOutputTokens,
			totalTokens: state.totalTokens,
			secondsRunning: state.endedSessionSeconds + activeSeconds,
		}),
		observability: new RuntimeObservability({
			commandQueueDepth: state.commandQueueDepth,
			commandQueuePeak: state.commandQueuePeak,
			commandQueuePressureCount: state.commandQueuePressureCount,
			staleRetryDropCount: state.staleRetryDropCount,
			retriesScheduledByReason: state.retriesScheduledByReason,
			workerStopsByReason: state.workerStopsByReason,
			workerExitsByReason: state.workerExitsByReason,
		}),
		rateLimits: null,
	});
};

export class Orchestrator extends ServiceMap.Service<Orchestrator>()("Orchestrator", {
	make: Effect.gen(function* () {
		const registry = yield* AtomRegistry.AtomRegistry;
		const stateAtom = Atom.make(initialState);
		registry.mount(stateAtom);
		const pendingPollTickRef = yield* Ref.make(false);
		const retryTimerFibersRef = yield* Ref.make(new Map<string, Fiber.Fiber<void, never>>());
		const workflowLoader = yield* WorkflowLoader;
		const tracker = yield* TrackerClient;
		const agentService = yield* AgentService;
		const workspaceManager = yield* WorkspaceManager;
		const eventPubSub = yield* PubSub.bounded<AgentRuntimeEvent>(512);
		const commandMailbox = yield* Queue.bounded<OrchestratorCommand>(COMMAND_QUEUE_CAPACITY);

		const overrides = yield* WorkflowOverridesConfig.pipe(Config.nested("PLOT"));

		const configAtom = Atom.make<ResolvedConfig | null>(null);
		registry.mount(configAtom);

		const getState = Effect.sync(() => registry.get(stateAtom));

		const getConfig = Effect.sync(() => registry.get(configAtom));

		const updateState = (fn: (s: OrchestratorState) => OrchestratorState) =>
			Effect.sync(() => registry.update(stateAtom, fn));

		const incrementCommandQueuePressure = (queueSize: number) =>
			updateState((s) => incrementCommandQueuePressureInState(s, queueSize));

		const noteCommandQueueSize = (queueSize: number) =>
			updateState((s) => noteCommandQueueSizeInState(s, queueSize));

		const getCommandQueueDepth = Queue.size(commandMailbox);

		const enqueueCommand = Effect.fnUntraced(function* (command: OrchestratorCommand) {
			const queueSize = yield* Queue.size(commandMailbox);
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
			yield* Queue.offer(commandMailbox, command);
		});

		const requestTick = Effect.fnUntraced(function* (
			reason: string,
			options?: { readonly coalesce?: boolean },
		) {
			if (options?.coalesce) {
				const shouldEnqueue = yield* Ref.modify(pendingPollTickRef, (pending) =>
					pending ? [false, pending] : [true, true],
				);
				if (!shouldEnqueue) return;
			}
			yield* enqueueCommand({
				_tag: "tick",
				reason,
				coalesced: options?.coalesce ?? false,
			});
		});

		const consumeEvent = Effect.fnUntraced(function* (event: AgentRuntimeEvent) {
			const now = yield* Clock.currentTimeMillis;
			yield* updateState((s) => consumeRuntimeEvent(s, event, now));
		});

		const dispatchRuntime = makeDispatchRuntime({
			getState,
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
			getState,
			tracker,
			removeWorkspace: (identifier, config) => workspaceManager.removeWorkspace(identifier, config),
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
							Effect.catch((e) =>
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
				Match.discriminator("_tag")("runtime_event", (cmd) => consumeEvent(cmd.event)),
				Match.discriminator("_tag")("retry_due", (cmd) => tickRuntime.handleRetryDue(cmd)),
				Match.discriminator("_tag")("worker_exit", (cmd) =>
					dispatchRuntime.handleWorkerExit(cmd).pipe(
						Effect.catch((e) =>
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
				const command = yield* Queue.take(commandMailbox);
				const queueSize = yield* Queue.size(commandMailbox);
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
			yield* Effect.sync(() => registry.set(configAtom, resolved));
		});

		const start = Effect.fnUntraced(function* (workflowPath: string) {
			yield* workflowLoader.load(workflowPath).pipe(Effect.catch((e) => Effect.die(e)));

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
		const stateStream = AtomRegistry.toStream(registry, stateAtom);

		const snapshotStream = stateStream.pipe(Stream.map(mapRuntimeSnapshot));

		const getSnapshot = withOrchestratorAvailability(
			getState.pipe(Effect.map(mapRuntimeSnapshot)),
		);

		const getEventLog = Effect.fnUntraced(function* (identifier: string) {
			const state = yield* withOrchestratorAvailability(getState);
			const log = [...state.eventLogs.values()].find((l) => l.issueIdentifier === identifier);
			if (!log) {
				return yield* Effect.fail(
					new IssueNotFound({
						identifier,
						message: `Event log not found: ${identifier}`,
					}),
				);
			}
			return new IssueEventLog({
				issueId: log.issueId,
				issueIdentifier: log.issueIdentifier,
				events: [...log.events],
			});
		});

		const triggerRefresh = Effect.gen(function* () {
			yield* withOrchestratorAvailability(tick);
			return new RefreshResult({
				queued: true,
				coalesced: false,
				requestedAt: DateTime.nowUnsafe(),
				operations: ["poll", "reconcile"],
			});
		});

		return {
			start,
			tick,
			getState,
			getConfig,
			getCommandQueueDepth,
			eventStream,
			stateStream,
			snapshotStream,
			getSnapshot,
			getEventLog,
			triggerRefresh,
		};
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
