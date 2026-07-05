import { EventHub } from "@plot/common/event-stream";
import {
	makePlotAgentLayer,
	type PlotAgent,
	type PlotAgentLayerOptions,
} from "@plot/agent/agent";
import type {
	PlotAgentEvent,
	RuntimeSnapshot,
	TickResult,
} from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import type {
	AgentEventInput,
	SessionEventInput,
	RuntimeEvent,
} from "./runtime-event.js";
import {
	makeAgentEventRecord,
	makeSessionEventRecord,
} from "./runtime-event.js";
import {
	startOwnedTask,
	type SessionRuntime,
	type SessionRuntimeState,
	type SessionSnapshot,
	type SessionTickResult,
} from "./runtime.js";

export interface AgentSessionRuntimeOptions {
	readonly id: string;
	readonly sources: readonly WorkSource[];
	readonly runner: WorkRunner;
	readonly state?: Omit<SessionRuntimeState, "sessionId" | "lastSequence">;
	readonly agent?: Omit<PlotAgentLayerOptions, "sources" | "runner">;
	readonly eventCapacity?: number;
}

const nonEmpty = (value: string, field: string): string => {
	if (value.length === 0) throw new Error(`${field} must be non-empty`);
	return value;
};

const objectFromMap = (value: unknown): unknown =>
	value instanceof Map ? Object.fromEntries(value.entries()) : value;

const snapshotForProtocol = (
	sessionId: string,
	snapshot: RuntimeSnapshot,
): SessionSnapshot => ({
	sessionId,
	work: objectFromMap(snapshot.work),
	running: objectFromMap(snapshot.running),
	facts: objectFromMap(snapshot.facts),
});

const compactTickResult = (result: TickResult): SessionTickResult => ({
	tickId: result.tickId,
	selectedCount: result.selected.length,
	startedCount: result.started.length,
	runningCount: result.snapshot.running.size,
	completionCount: result.completions.length,
	diagnosticCount: result.diagnostics.length,
	...(result.diagnostics.length === 0
		? {}
		: { diagnostics: result.diagnostics }),
});

const agentEventInput = (event: PlotAgentEvent) => {
	if (event.type === "tick_started")
		return { type: "tick_started", payload: { tickId: event.tickId } };
	if (event.type === "tick_completed")
		return {
			type: "tick_completed",
			payload: { result: compactTickResult(event.result) },
		};
	if (event.type === "work_observed")
		return { type: "work_observed", payload: { work: event.work } };
	if (event.type === "work_removed")
		return { type: "work_removed", payload: { workKey: event.workKey } };
	if (event.type === "wake_scheduled")
		return { type: "wake_scheduled", payload: event };
	if (event.type === "attempt_started")
		return { type: "attempt_started", payload: { run: event.run } };
	return {
		type: "attempt_completed",
		payload: { completion: event.completion },
	};
};

export const makeAgentSessionRuntime = (
	options: AgentSessionRuntimeOptions,
): SessionRuntime => {
	const sessionId = nonEmpty(options.id, "session id");
	const events = new EventHub<RuntimeEvent>(options.eventCapacity ?? 256);
	const agent: PlotAgent = makePlotAgentLayer({
		...options.agent,
		sources: options.sources,
		runner: options.runner,
	});
	let shutdownPromise: Promise<boolean> | undefined;

	let liveSequence = 0;
	const publish = (record: RuntimeEvent): RuntimeEvent => {
		const liveRecord =
			record.sequence > liveSequence
				? record
				: { ...record, sequence: liveSequence + 1 };
		liveSequence = liveRecord.sequence;
		events.publish(liveRecord);
		return liveRecord;
	};
	const publishSessionEvent = async (
		input: SessionEventInput,
	): Promise<RuntimeEvent> => {
		const record = publish(
			makeSessionEventRecord({
				sessionId,
				sequence: liveSequence + 1,
				event: input,
			}),
		);
		return record;
	};
	const publishAgentEvent = async (
		input: AgentEventInput,
	): Promise<RuntimeEvent> =>
		publish(
			makeAgentEventRecord({
				sessionId,
				sequence: liveSequence + 1,
				event: input,
			}),
		);

	const agentEvents = startOwnedTask({
		name: "session.runtime.agent_events",
		run: async (signal) => {
			for await (const event of agent.events()) {
				if (signal.aborted) return;
				await publishSessionEvent(agentEventInput(event));
			}
		},
	});

	return {
		id: sessionId,
		start: async () => {
			await publishSessionEvent({ type: "session_started" });
			await agent.start();
		},
		tickOnce: async () => compactTickResult(await agent.tickOnce()),
		state: async () => ({
			sessionId,
			...options.state,
			lastSequence: liveSequence,
		}),
		snapshot: async () =>
			snapshotForProtocol(sessionId, await agent.snapshot()),
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
				events.close();
				return accepted;
			})();
			return shutdownPromise;
		},
	};
};
