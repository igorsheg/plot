import { EventHub } from "@plot/common/event-stream";
import { withWideEvent } from "@plot/common/observability";
import type {
	Observation,
	PlotAgentEvent,
	RuntimeSnapshot,
	SubjectKey,
	TickResult,
} from "@plot/agent/model";
import { makePlotAgentLayer } from "@plot/agent/agent";
import type { PlotAgentLayerOptions, PlotAgentShape } from "@plot/agent/agent";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import type { EventLogEvent } from "@plot/session/protocol";
import type { EventLogAppendInput, EventLogStore } from "./event-log.js";
import type { WorkflowDefinition } from "./workflow.js";

export type PlotSessionId = string;
export const plotSessionId = (value: string): PlotSessionId => {
	if (value.length === 0) throw new Error("invalid session id");
	return value;
};
export class PlotSessionError extends Error {
	readonly phase = "setup";
	constructor(input: { readonly phase?: "setup"; readonly message: string }) {
		super(input.message);
		this.name = "PlotSessionError";
	}
}

export interface PlotSessionShape {
	readonly id: PlotSessionId;
	readonly workflow: WorkflowDefinition;
	readonly start: () => Promise<void>;
	readonly tickOnce: () => Promise<TickResult>;
	readonly submitObservation: (observation: Observation) => Promise<boolean>;
	readonly snapshot: () => Promise<RuntimeSnapshot>;
	readonly interruptAgentRun: (input: {
		readonly runId: string;
		readonly workKey?: string;
	}) => Promise<boolean>;
	readonly pauseDispatch: () => Promise<void>;
	readonly resumeDispatch: () => Promise<void>;
	readonly events: () => AsyncIterable<EventLogEvent>;
	readonly lastEventSequence: () => Promise<number>;
	readonly shutdown: () => Promise<boolean>;
}
export type PlotSession = PlotSessionShape;
export const PlotSession = Symbol("PlotSession");
interface BasePlotSessionLayerOptions {
	readonly id?: PlotSessionId;
	readonly workflow: WorkflowDefinition;
	readonly sources: readonly WorkSource[];
	readonly agent?: Omit<PlotAgentLayerOptions, "sources" | "runner">;
	readonly eventCapacity?: number;
	readonly eventLog?: EventLogStore;
}
export type PlotSessionAgentEventSink = (
	context: WorkRunnerContext,
	event: unknown,
) => Promise<void>;
export interface PlotSessionLayerOptions extends BasePlotSessionLayerOptions {
	readonly runner:
		| WorkRunner
		| ((emitAgentEvent: PlotSessionAgentEventSink) => WorkRunner);
}
const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };
const compactTickResult = (result: TickResult) => ({
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

const historyForPlotAgentEvent = (
	event: PlotAgentEvent,
): EventLogAppendInput => {
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
export function makePlotSessionLayer(
	options: PlotSessionLayerOptions,
): PlotSessionShape {
	const sessionId = options.id ?? plotSessionId("default");
	const eventCapacity = options.eventCapacity ?? 256;
	if (!Number.isInteger(eventCapacity) || eventCapacity < 1)
		throw new PlotSessionError({
			message: "eventCapacity must be a positive integer",
		});
	const events = new EventHub<EventLogEvent>(eventCapacity);
	let sequence = 0,
		shutdownPromise: Promise<boolean> | undefined;
	const appendSessionEvent = async (input: EventLogAppendInput) => {
		const event = options.eventLog
			? await options.eventLog.append(input)
			: (() => {
					const nextSequence = ++sequence;
					const timestamp = input.timestamp ?? new Date().toISOString();
					const payload = input.payload ?? {};
					const payloadRecord = payload as Record<string, unknown>;
					return input.type === "agent_run_event" &&
						typeof payload === "object" &&
						payload !== null &&
						"event" in payload
						? ({
								kind: "agent_session_event",
								sessionId,
								sequence: nextSequence,
								timestamp,
								type: "agent_session_event",
								...(typeof payloadRecord["sourceId"] === "string"
									? { sourceId: payloadRecord["sourceId"] }
									: {}),
								...(typeof payloadRecord["runId"] === "string"
									? { runId: payloadRecord["runId"] }
									: {}),
								...(typeof payloadRecord["workKey"] === "string"
									? { workKey: payloadRecord["workKey"] }
									: {}),
								event: payloadRecord["event"],
							} as EventLogEvent)
						: ({
								kind: "plot_event",
								sessionId,
								sequence: nextSequence,
								timestamp,
								type: input.type,
								payload,
							} as EventLogEvent);
				})();
		sequence = Number(event.sequence);
		events.publish(event);
		return event;
	};
	const publishAgentEvent: PlotSessionAgentEventSink = async (
		context,
		event,
	) => {
		await appendSessionEvent({
			type: "agent_run_event",
			payload: {
				sourceId: context.sourceId,
				runId: context.run.runId,
				workKey: context.work.workKey,
				...optionalSubject(context.work.subject),
				...(typeof event === "object" &&
				event !== null &&
				"type" in event &&
				typeof event.type === "string"
					? { eventType: event.type }
					: {}),
				event,
			},
		});
	};
	const runner =
		typeof options.runner === "function"
			? options.runner(publishAgentEvent)
			: options.runner;
	const plotAgent: PlotAgentShape = makePlotAgentLayer({
		...options.agent,
		sources: options.sources,
		runner,
	});
	const agentEventsDone = (async () => {
		for await (const event of plotAgent.events())
			await appendSessionEvent(historyForPlotAgentEvent(event));
	})().catch(() => undefined);
	return {
		id: sessionId,
		workflow: options.workflow,
		start: async () =>
			withWideEvent(
				"plot_session.start",
				{ session_id: sessionId },
				async () => {
					await appendSessionEvent({ type: "session_started", payload: {} });
					await plotAgent.start();
				},
			),
		tickOnce: async () =>
			withWideEvent(
				"plot_session.tick_once",
				{ session_id: sessionId },
				plotAgent.tickOnce(),
			),
		submitObservation: async (observation) =>
			withWideEvent(
				"plot_session.submit_observation",
				{ session_id: sessionId, observation_type: observation.type },
				async () => {
					const accepted = await plotAgent.offer({
						type: "observation",
						observation,
					});
					if (accepted)
						await appendSessionEvent({
							type: "observation_submitted",
							payload: { observation },
						});
					return accepted;
				},
			),
		snapshot: async () =>
			withWideEvent(
				"plot_session.snapshot",
				{ session_id: sessionId },
				plotAgent.snapshot(),
			),
		interruptAgentRun: async (input) =>
			withWideEvent(
				"plot_session.interrupt_agent_run",
				{ session_id: sessionId, run_id: input.runId },
				plotAgent.interruptAgentRun(input),
			),
		pauseDispatch: async () => plotAgent.pauseDispatch(),
		resumeDispatch: async () => plotAgent.resumeDispatch(),
		events: () => events.subscribe(),
		lastEventSequence: async () =>
			options.eventLog
				? (await options.eventLog.frontier()).lastSequence
				: sequence,
		shutdown: async () => {
			shutdownPromise ??= withWideEvent(
				"plot_session.shutdown",
				{ session_id: sessionId },
				async () => {
					const accepted = await plotAgent.shutdown();
					await agentEventsDone;
					await appendSessionEvent({ type: "session_shutdown", payload: {} });
					events.close();
					return accepted;
				},
			);
			return shutdownPromise;
		},
	};
}
