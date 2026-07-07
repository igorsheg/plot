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

export interface SessionRuntime {
	readonly id: string;
	readonly start: () => Promise<void>;
	readonly tickOnce: () => Promise<TickSummary>;
	readonly state: () => Promise<SessionRuntimeState>;

	readonly pauseDispatch: () => Promise<void>;
	readonly resumeDispatch: () => Promise<void>;
	readonly interruptAgentRun: (
		input: InterruptAgentRunInput,
	) => Promise<boolean>;
	readonly recordOperatorObservation: (
		input: OperatorObservationInput,
	) => Promise<boolean>;
	readonly events: () => AsyncIterable<RuntimeEvent>;
	readonly appendAgentEvent: (input: AgentEventInput) => Promise<RuntimeEvent>;
	readonly lastEventSequence: () => Promise<number>;
	readonly shutdown: () => Promise<boolean>;
}

export interface OwnedTask {
	readonly name: string;
	readonly done: Promise<void>;
	readonly stop: () => void | Promise<void>;
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
	});
	return {
		name: input.name,
		done,
		stop: () => controller.abort(),
	};
};

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
	let shutdownPromise: Promise<boolean> | undefined;

	let liveSequence = 0;
	const eventLog =
		options.sessionFile === undefined
			? undefined
			: createSessionEventLogWriter(options.sessionFile);
	let publishChain: Promise<void> = Promise.resolve();
	const publish = (record: RuntimeEvent): Promise<RuntimeEvent> => {
		const published = publishChain.then(async () => {
			const liveRecord =
				record.sequence > liveSequence
					? record
					: { ...record, sequence: liveSequence + 1 };
			await eventLog?.append(liveRecord);
			liveSequence = liveRecord.sequence;
			events.publish(liveRecord);
			return liveRecord;
		});
		publishChain = published.then(
			() => undefined,
			() => undefined,
		);
		return published;
	};
	const publishSessionEvent = async (
		event: SessionEvent,
	): Promise<RuntimeEvent> =>
		publish({
			kind: "session_event",
			sessionId,
			sequence: liveSequence + 1,
			timestamp: new Date().toISOString(),
			event,
		});
	const publishAgentEvent = async (
		input: AgentEventInput,
	): Promise<RuntimeEvent> =>
		publish({
			kind: "agent_event",
			sessionId,
			sequence: liveSequence + 1,
			timestamp: new Date().toISOString(),
			sourceId: input.sourceId,
			runId: input.runId,
			workKey: input.workKey,
			event: input.event,
		});

	const agentEvents = startOwnedTask({
		name: "session.runtime.agent_events",
		run: async (signal) => {
			for await (const event of agent.events()) {
				if (signal.aborted) return;
				await publishSessionEvent(toSessionEvent(event));
			}
		},
	});

	return {
		id: sessionId,
		start: async () => {
			await publishSessionEvent({ type: "session_started" });
			await agent.start();
		},
		tickOnce: async () => toTickSummary(await agent.tickOnce()),
		state: async () => ({
			sessionId,
			...options.state,
			sessionFile: options.sessionFile,
			lastSequence: liveSequence,
		}),

		pauseDispatch: () => agent.pauseDispatch(),
		resumeDispatch: () => agent.resumeDispatch(),
		interruptAgentRun: (input) => agent.interruptAgentRun(input),
		recordOperatorObservation: async (input) => {
			const accepted = await agent.offer({
				type: "observation",
				observation: {
					type: "operator_observation",
					data: { ...input, timestamp: new Date().toISOString() },
				},
			});
			// Reconcile promptly: the operator is watching.
			if (accepted) await agent.wakeAfter(1, "operator observation");
			return accepted;
		},
		events: () => events.subscribe(),
		appendAgentEvent: publishAgentEvent,
		lastEventSequence: async () => liveSequence,
		shutdown: async () => {
			shutdownPromise ??= (async () => {
				const accepted = await agent.shutdown();
				await agentEvents.done;
				await publishSessionEvent({ type: "session_shutdown" });
				await eventLog?.close();
				events.close();
				return accepted;
			})();
			return shutdownPromise;
		},
	};
};
