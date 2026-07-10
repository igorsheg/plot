import { randomUUID } from "node:crypto";
import { EventHub } from "@plot/common/event-stream";
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
type UnsequencedRuntimeEvent = Omit<RuntimeEvent, "sequence">;

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

export interface OperatorObservationInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly comment?: string | undefined;
	readonly clientId?: string | undefined;
	readonly actor?: string | undefined;
}

export interface SessionRuntimeState {
	readonly sessionId: string;
	readonly workflowName?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly cwd?: string | undefined;
	readonly cwdName?: string | undefined;
	readonly sessionDir?: string | undefined;
	readonly sessionFile?: string | undefined;
	readonly lastSequence?: number | undefined;
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
	const events = new EventHub<RuntimeEvent>(options.eventCapacity ?? 256);
	const agent: PlotAgent = makePlotAgent({
		...options.agent,
		sources: [...options.sources],
		runner: options.runner,
	});
	const eventLog = options.sessionFile
		? createSessionEventLogWriter(options.sessionFile)
		: undefined;
	let sequence = 0;
	let publishChain: Promise<unknown> = Promise.resolve();
	let lifecycle: "open" | "closing" | "closed" = "open";
	let execution: "idle" | "continuous" | "once" = "idle";
	let sessionStarted: Promise<void> | undefined;
	let agentStarted: Promise<void> | undefined;
	let runOncePromise: Promise<TickSummary> | undefined;
	let shutdownPromise: Promise<boolean> | undefined;
	let publishedTick = 0;
	let agentEventFailure: unknown;
	const tickWaiters = new Map<number, Deferred[]>();
	const completionWaiters = new Map<string, Deferred[]>();

	const assertOpen = (operation: string): void => {
		if (lifecycle !== "open")
			throw new Error(`cannot ${operation}: session runtime is closed`);
	};
	const rejectWaiters = (error: unknown): void => {
		for (const waiters of [
			...tickWaiters.values(),
			...completionWaiters.values(),
		])
			for (const waiter of waiters) waiter.reject(error);
		tickWaiters.clear();
		completionWaiters.clear();
	};

	const publish = (record: UnsequencedRuntimeEvent): Promise<RuntimeEvent> => {
		const next = publishChain.then(async () => {
			const event = { ...record, sequence: ++sequence } as RuntimeEvent;
			await eventLog?.append(event);
			events.publish(event);
			return event;
		});
		publishChain = next;
		return next;
	};
	const publishSessionEvent = (event: SessionEvent) =>
		publish({
			kind: "session_event",
			sessionId: options.id,
			timestamp: new Date().toISOString(),
			event,
		});
	const publishAgentEvent = (input: AgentEventInput) =>
		publish({
			kind: "agent_event",
			sessionId: options.id,
			timestamp: new Date().toISOString(),
			...input,
		});
	const resolveTick = (
		event: Extract<PlotAgentEvent, { type: "tick_completed" }>,
	): void => {
		publishedTick = Math.max(publishedTick, event.result.tickId);
		for (const [target, waiters] of tickWaiters) {
			if (target > publishedTick) continue;
			for (const waiter of waiters) waiter.resolve();
			tickWaiters.delete(target);
		}
		for (const completion of event.result.completions) {
			const waiters = completionWaiters.get(completion.runId);
			if (waiters === undefined) continue;
			for (const waiter of waiters) waiter.resolve();
			completionWaiters.delete(completion.runId);
		}
	};

	const agentEvents = (async () => {
		try {
			for await (const event of agent.events()) {
				await publishSessionEvent(toSessionEvent(event));
				if (event.type === "tick_completed") resolveTick(event);
			}
		} catch (error) {
			agentEventFailure = error;
			rejectWaiters(error);
			throw error;
		}
	})();
	const wait = <K>(waiters: Map<K, Deferred[]>, key: K): Promise<void> =>
		new Promise<void>((resolve, reject) => {
			if (agentEventFailure !== undefined) {
				reject(agentEventFailure);
				return;
			}
			const list = waiters.get(key) ?? [];
			list.push({ resolve, reject });
			waiters.set(key, list);
		});
	const waitForPublishedTick = (tickId: number): Promise<void> =>
		publishedTick >= tickId ? Promise.resolve() : wait(tickWaiters, tickId);
	const waitForReconciledCompletion = (runId: string): Promise<void> =>
		wait(completionWaiters, runId);
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
		id: options.id,
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
			if (execution !== "idle" || publishedTick !== 0)
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
			await publishChain;
			return {
				sessionId: options.id,
				...options.state,
				sessionFile: options.sessionFile,
				lastSequence: sequence,
			};
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
		pauseDispatch: () => {
			assertOpen("pause dispatch");
			return agent.pauseDispatch();
		},
		resumeDispatch: () => {
			assertOpen("resume dispatch");
			return agent.resumeDispatch();
		},
		interruptAgentRun: (input) => {
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
			await publishChain;
			return sequence;
		},
		shutdown: () => {
			if (shutdownPromise !== undefined) return shutdownPromise;
			lifecycle = "closing";
			shutdownPromise = (async () => {
				try {
					const accepted = await agent.shutdown();
					await agentEvents;
					await publishSessionEvent({ type: "session_shutdown" });
					return accepted;
				} finally {
					lifecycle = "closed";
					events.close();
					rejectWaiters(new Error("session runtime is closed"));
					await eventLog?.close();
				}
			})();
			return shutdownPromise;
		},
	};
};
