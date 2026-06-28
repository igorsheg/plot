import { EventHub } from "@plot/common/event-stream";
import {
	makePlotAgentLayer,
	type PlotAgentLayerOptions,
	type PlotAgentShape,
} from "@plot/agent/agent";
import type {
	PlotAgentEvent,
	RuntimeSnapshot,
	TickResult,
} from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import type { EventLogRecord, EventLogStore } from "./event-log.js";
import {
	startOwnedTask,
	type SessionRuntime,
	type SessionSnapshot,
	type SessionTickResult,
} from "./runtime.js";

export interface AgentSessionRuntimeOptions {
	readonly id: string;
	readonly eventLog: EventLogStore;
	readonly sources: readonly WorkSource[];
	readonly runner: WorkRunner;
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
	const events = new EventHub<EventLogRecord>(options.eventCapacity ?? 256);
	const agent: PlotAgentShape = makePlotAgentLayer({
		...options.agent,
		sources: options.sources,
		runner: options.runner,
	});
	let shutdownPromise: Promise<boolean> | undefined;

	const appendAndPublish = async (
		append: () => Promise<EventLogRecord>,
	): Promise<EventLogRecord> => {
		const record = await append();
		events.publish(record);
		return record;
	};

	const agentEvents = startOwnedTask({
		name: "session.runtime.agent_events",
		run: async (signal) => {
			for await (const event of agent.events()) {
				if (signal.aborted) return;
				const input = agentEventInput(event);
				await appendAndPublish(() =>
					options.eventLog.appendSessionEvent(input),
				);
			}
		},
	});

	return {
		id: sessionId,
		start: async () => {
			await appendAndPublish(() =>
				options.eventLog.appendSessionEvent({ type: "session_started" }),
			);
			await agent.start();
		},
		tickOnce: async () => compactTickResult(await agent.tickOnce()),
		snapshot: async () =>
			snapshotForProtocol(sessionId, await agent.snapshot()),
		pauseDispatch: () => agent.pauseDispatch(),
		resumeDispatch: () => agent.resumeDispatch(),
		interruptAgentRun: (input) => agent.interruptAgentRun(input),
		events: () => events.subscribe(),
		lastEventSequence: async () =>
			(await options.eventLog.frontier()).lastSequence,
		shutdown: async () => {
			shutdownPromise ??= (async () => {
				const accepted = await agent.shutdown();
				await agentEvents.done;
				await appendAndPublish(() =>
					options.eventLog.appendSessionEvent({ type: "session_shutdown" }),
				);
				events.close();
				return accepted;
			})();
			return shutdownPromise;
		},
	};
};
