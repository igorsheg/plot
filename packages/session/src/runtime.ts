import { randomUUID } from "node:crypto";
import { EventHub } from "@plot/common/event-stream";
import type { Mutable } from "@plot/common/primitives";
import {
	makePlotAgent,
	type PlotAgent,
	type PlotAgentOptions,
} from "@plot/agent/agent";
import type {
	Completion,
	Diagnostic,
	PlotAgentEvent,
	ScheduledWake,
	TickResult,
	WorkRecord,
	WorkRun,
} from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import { createSessionEventLogWriter } from "./history.js";

export interface TickSummary {
	readonly tickId: number;
	readonly selected: number;
	readonly started: number;
	readonly running: number;
	readonly completions: number;
	readonly diagnostics: readonly Diagnostic[];
}

/** Scheduler events, typed end-to-end. tick_completed is summarized; the rest pass through. */
export type SessionEvent =
	| { readonly type: "session_started" }
	| { readonly type: "session_shutdown" }
	| { readonly type: "tick_started"; readonly tickId: number }
	| { readonly type: "tick_completed"; readonly result: TickSummary }
	| { readonly type: "work_observed"; readonly work: WorkRecord }
	| { readonly type: "work_removed"; readonly workKey: string }
	| {
			readonly type: "wake_scheduled";
			readonly delayMs: number;
			readonly reason?: string;
			readonly workKey?: string;
			readonly attempt?: number;
	  }
	| { readonly type: "attempt_started"; readonly run: WorkRun }
	| { readonly type: "attempt_completed"; readonly completion: Completion };

export interface SessionEventRecord {
	readonly kind: "session_event";
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp: string;
	readonly event: SessionEvent;
}

/** A raw inner-agent event relayed verbatim (pi AgentSessionEvent or the plot_transcript synthetic). */
export interface AgentEventRecord {
	readonly kind: "agent_event";
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp: string;
	readonly sourceId: string;
	readonly runId: string;
	readonly workKey: string;
	readonly event: unknown;
}

export type RuntimeEvent = SessionEventRecord | AgentEventRecord;

type UnsequencedRuntimeEvent =
	| Omit<SessionEventRecord, "sequence">
	| Omit<AgentEventRecord, "sequence">;

export interface AgentEventInput {
	readonly sourceId: string;
	readonly runId: string;
	readonly workKey: string;
	readonly event: unknown;
}

export interface InterruptAgentRunInput {
	readonly runId: string;
	readonly workKey?: string;
}

/** A human decision on a Work Item, recorded so Sources reconcile with it. */
export interface OperatorObservationInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly comment?: string;
	readonly clientId?: string;
	readonly actor?: string;
}

export interface SessionRuntimeState {
	readonly sessionId: string;
	readonly workflowName?: string;
	readonly workflowPath?: string;
	readonly cwd?: string;
	readonly cwdName?: string;
	readonly sessionDir?: string;
	readonly sessionFile?: string;
	readonly lastSequence?: number;
}

export interface SchedulerSnapshotState {
	readonly tickId: number;
	readonly work: readonly WorkRecord[];
	readonly running: readonly WorkRun[];
	readonly scheduledWakes: readonly ScheduledWake[];
	readonly diagnostics: readonly Diagnostic[];
}

export interface SessionRuntime {
	readonly id: string;
	readonly start: () => Promise<void>;
	readonly runOnce: () => Promise<TickSummary>;
	readonly tickOnce: () => Promise<TickSummary>;
	readonly state: () => Promise<SessionRuntimeState>;
	readonly schedulerSnapshot: () => Promise<SchedulerSnapshotState>;
	readonly pauseDispatch: () => Promise<void>;
	readonly resumeDispatch: () => Promise<void>;
	readonly interruptAgentRun: (
		input: InterruptAgentRunInput,
	) => Promise<boolean>;
	readonly recordOperatorObservation: (
		input: OperatorObservationInput,
	) => Promise<boolean>;
	readonly events: (signal?: AbortSignal) => AsyncIterable<RuntimeEvent>;
	readonly appendAgentEvent: (input: AgentEventInput) => Promise<RuntimeEvent>;
	readonly lastEventSequence: () => Promise<number>;
	readonly shutdown: () => Promise<boolean>;
}

export interface OwnedTask {
	readonly name: string;
	readonly done: Promise<void>;
	readonly stop: () => void;
}

export const startOwnedTask = (input: {
	readonly name: string;
	readonly run: (signal: AbortSignal) => Promise<void>;
	readonly onError?: (error: unknown) => void | Promise<void>;
}): OwnedTask => {
	const controller = new AbortController();
	const done = input.run(controller.signal).catch(async (error) => {
		if (controller.signal.aborted) return;
		await input.onError?.(error);
		throw error;
	});
	return {
		name: input.name,
		done,
		stop: () => controller.abort(),
	};
};

export class SessionRuntimeClosedError extends Error {
	override readonly name = "SessionRuntimeClosedError";

	constructor(operation: string) {
		super(`cannot ${operation}: session runtime is closed`);
	}
}

export const createSessionId = (): string => `session-${randomUUID()}`;

export interface SessionRuntimeOptions {
	readonly id: string;
	readonly sources: readonly WorkSource[];
	readonly runner: WorkRunner;
	readonly state?: Omit<SessionRuntimeState, "sessionId" | "lastSequence">;
	readonly sessionFile?: string;
	readonly agent?: Omit<PlotAgentOptions, "sources" | "runner">;
	readonly eventCapacity?: number;
}

const toTickSummary = (result: TickResult): TickSummary => ({
	tickId: result.tickId,
	selected: result.selected.length,
	started: result.started.length,
	running: result.snapshot.running.size,
	completions: result.completions.length,
	diagnostics: result.diagnostics,
});

const toSessionEvent = (event: PlotAgentEvent): SessionEvent =>
	event.type === "tick_completed"
		? { type: "tick_completed", result: toTickSummary(event.result) }
		: event;

interface Deferred {
	readonly resolve: () => void;
	readonly reject: (error: unknown) => void;
}

export const makeSessionRuntime = (
	options: SessionRuntimeOptions,
): SessionRuntime => {
	if (options.id.length === 0) throw new Error("session id must be non-empty");
	const sessionId = options.id;
	const events = new EventHub<RuntimeEvent>(options.eventCapacity ?? 256);
	const agent: PlotAgent = makePlotAgent({
		...options.agent,
		sources: [...options.sources],
		runner: options.runner,
	});
	const eventLog = options.sessionFile
		? createSessionEventLogWriter(options.sessionFile)
		: undefined;
	let liveSequence = 0;
	let lifecycle: "open" | "closing" | "closed" = "open";
	let execution: "idle" | "continuous" | "once" = "idle";
	let publicationFailure: unknown;
	let publishChain = Promise.resolve();
	let sessionStarted: Promise<void> | undefined;
	let agentStarted: Promise<void> | undefined;
	let runOncePromise: Promise<TickSummary> | undefined;
	let shutdownPromise: Promise<boolean> | undefined;
	let latestPublishedTick = 0;
	let agentEventFailure: unknown;
	const tickWaiters = new Map<number, Deferred[]>();
	const completionWaiters = new Map<string, Deferred[]>();
	const completionsInPublishedTick = new Set<string>();

	const assertOpen = (operation: string): void => {
		if (lifecycle !== "open") throw new SessionRuntimeClosedError(operation);
	};
	const rejectWaiters = (error: unknown): void => {
		for (const waiters of tickWaiters.values())
			for (const waiter of waiters) waiter.reject(error);
		for (const waiters of completionWaiters.values())
			for (const waiter of waiters) waiter.reject(error);
		tickWaiters.clear();
		completionWaiters.clear();
	};
	const publish = (record: UnsequencedRuntimeEvent): Promise<RuntimeEvent> => {
		const published = publishChain.then(async (): Promise<RuntimeEvent> => {
			const liveRecord = { ...record, sequence: liveSequence + 1 };
			await eventLog?.append(liveRecord);
			liveSequence = liveRecord.sequence;
			events.publish(liveRecord);
			return liveRecord;
		});
		publishChain = published.then(
			() => undefined,
			(error) => {
				publicationFailure ??= error;
			},
		);
		return published;
	};
	const flushPublished = async (): Promise<void> => {
		await publishChain;
		if (publicationFailure !== undefined) throw publicationFailure;
	};
	const publishSessionEvent = (event: SessionEvent): Promise<RuntimeEvent> =>
		publish({
			kind: "session_event",
			sessionId,
			timestamp: new Date().toISOString(),
			event,
		});
	const publishAgentEvent = (input: AgentEventInput): Promise<RuntimeEvent> =>
		publish({
			kind: "agent_event",
			sessionId,
			timestamp: new Date().toISOString(),
			sourceId: input.sourceId,
			runId: input.runId,
			workKey: input.workKey,
			event: input.event,
		});
	const resolveTick = (tickId: number): void => {
		latestPublishedTick = Math.max(latestPublishedTick, tickId);
		for (const [target, waiters] of tickWaiters) {
			if (target > latestPublishedTick) continue;
			for (const waiter of waiters) waiter.resolve();
			tickWaiters.delete(target);
		}
	};
	const resolveReconciledCompletions = (): void => {
		for (const runId of completionsInPublishedTick) {
			const waiters = completionWaiters.get(runId);
			if (waiters === undefined) continue;
			for (const waiter of waiters) waiter.resolve();
			completionWaiters.delete(runId);
		}
		completionsInPublishedTick.clear();
	};
	const waitForPublishedTick = (tickId: number): Promise<void> => {
		if (latestPublishedTick >= tickId) return Promise.resolve();
		if (agentEventFailure !== undefined)
			return Promise.reject(agentEventFailure);
		return new Promise<void>((resolve, reject) => {
			const waiters = tickWaiters.get(tickId) ?? [];
			waiters.push({ resolve, reject });
			tickWaiters.set(tickId, waiters);
		});
	};
	const waitForReconciledCompletion = (runId: string): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			const waiters = completionWaiters.get(runId) ?? [];
			waiters.push({ resolve, reject });
			completionWaiters.set(runId, waiters);
		});

	const agentEvents = startOwnedTask({
		name: "session.runtime.agent_events",
		run: async (signal) => {
			for await (const event of agent.events()) {
				if (signal.aborted) return;
				await publishSessionEvent(toSessionEvent(event));
				if (event.type === "attempt_completed")
					completionsInPublishedTick.add(event.completion.runId);
				if (event.type === "tick_completed") {
					resolveTick(event.result.tickId);
					resolveReconciledCompletions();
				}
			}
		},
		onError: (error) => {
			agentEventFailure = error;
			rejectWaiters(error);
		},
	});

	const startSession = (): Promise<void> => {
		sessionStarted ??= publishSessionEvent({ type: "session_started" }).then(
			() => undefined,
		);
		return sessionStarted;
	};
	const startAgent = (): Promise<void> => {
		agentStarted ??= agent.start();
		return agentStarted;
	};
	const tickAgent = async (): Promise<TickResult> => {
		const result = await agent.tickOnce();
		await waitForPublishedTick(result.tickId);
		return result;
	};

	return {
		id: sessionId,
		start: async () => {
			assertOpen("start");
			if (execution === "once")
				throw new Error("cannot start a one-shot session runtime");
			execution = "continuous";
			await startSession();
			await startAgent();
		},
		runOnce: () => {
			assertOpen("run once");
			if (runOncePromise !== undefined) return runOncePromise;
			if (execution !== "idle" || latestPublishedTick !== 0)
				throw new Error("runOnce requires a fresh session runtime");
			execution = "once";
			runOncePromise = (async () => {
				await startSession();
				const result = await tickAgent();
				await agent.pauseDispatch();
				const completions = result.started.map((run) =>
					waitForReconciledCompletion(run.runId),
				);
				if (completions.length > 0) {
					await startAgent();
					await Promise.all(completions);
				}
				return toTickSummary(result);
			})();
			return runOncePromise;
		},
		tickOnce: async () => {
			assertOpen("tick");
			return toTickSummary(await tickAgent());
		},
		state: async () => {
			await flushPublished();
			const state: Mutable<SessionRuntimeState> = {
				sessionId,
				...options.state,
				lastSequence: liveSequence,
			};
			if (options.sessionFile !== undefined)
				state.sessionFile = options.sessionFile;
			return state;
		},
		schedulerSnapshot: async () => {
			const snapshot = await agent.snapshot();
			return {
				tickId: snapshot.tickId,
				work: [...snapshot.work.values()],
				running: [...snapshot.running.values()],
				scheduledWakes: snapshot.scheduledWakes ?? [],
				diagnostics: snapshot.diagnostics,
			};
		},
		pauseDispatch: async () => {
			assertOpen("pause dispatch");
			await agent.pauseDispatch();
		},
		resumeDispatch: async () => {
			assertOpen("resume dispatch");
			await agent.resumeDispatch();
		},
		interruptAgentRun: async (input) => {
			assertOpen("interrupt an agent run");
			return agent.interruptAgentRun(input);
		},
		recordOperatorObservation: async (input) => {
			assertOpen("record an operator observation");
			const accepted = await agent.offer({
				type: "observation",
				observation: {
					type: "operator_observation",
					data: { ...input, timestamp: new Date().toISOString() },
				},
			});
			if (accepted) await agent.wakeAfter(1, "operator observation");
			return accepted;
		},
		events: (signal) => events.subscribe(signal),
		appendAgentEvent: async (input) => {
			assertOpen("append an agent event");
			return publishAgentEvent(input);
		},
		lastEventSequence: async () => {
			await flushPublished();
			return liveSequence;
		},
		shutdown: () => {
			if (shutdownPromise !== undefined) return shutdownPromise;
			lifecycle = "closing";
			shutdownPromise = (async () => {
				let failure: unknown;
				let accepted = false;
				try {
					accepted = await agent.shutdown();
					await agentEvents.done;
					await publishSessionEvent({ type: "session_shutdown" });
				} catch (error) {
					failure = error;
				}
				try {
					await eventLog?.close();
				} catch (error) {
					failure ??= error;
				}
				lifecycle = "closed";
				events.close();
				rejectWaiters(new SessionRuntimeClosedError("wait for an event"));
				if (failure !== undefined) throw failure;
				return accepted;
			})();
			return shutdownPromise;
		},
	};
};
