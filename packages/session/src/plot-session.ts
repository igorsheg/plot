import { EventHub } from "@plot/common/event-stream";
import { logWideEvent, withWideEvent } from "@plot/common/observability";
import type { AgentSessionEvent } from "./agent-session-types.js";
import type {
	Observation,
	PlotAgentEvent,
	RuntimeSnapshot,
	SubjectKey,
	TickResult,
	WorkResult,
} from "@plot/agent/model";
import { makePlotAgentLayer } from "@plot/agent/agent";
import type { PlotAgentLayerOptions, PlotAgentShape } from "@plot/agent/agent";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { WorkSource } from "@plot/agent/work-source";
import type {
	AgentSessionClientShape,
	PromptAgentSessionOptions,
} from "./agent-session-client.js";
import type { AgentSessionWorkRunnerOptions } from "./agent-session-runner.js";
import type {
	SessionHistoryAppendInput,
	SessionHistoryStore,
} from "./session-history.js";
import type { WorkflowDefinition } from "./workflow.js";
import {
	makePromptTemplateData,
	renderPromptTemplate,
} from "./workflow-template.js";

export type PlotSessionId = string;
export const plotSessionId = (value: string): PlotSessionId => {
	if (value.length === 0) throw new Error("invalid session id");
	return value;
};
export type PlotSessionEventSequence = number;
export const plotSessionEventSequence = (
	value: number,
): PlotSessionEventSequence => {
	if (!Number.isInteger(value) || value < 1)
		throw new Error("invalid event sequence");
	return value;
};
export type PlotSessionEventCursor = number;
export const plotSessionEventCursor = (
	value: number,
): PlotSessionEventCursor => {
	if (!Number.isInteger(value) || value < 0)
		throw new Error("invalid event cursor");
	return value;
};
export class SessionStartedEvent {
	readonly type = "session_started";
	constructor(
		readonly input: {
			readonly sessionId: PlotSessionId;
			readonly sequence: PlotSessionEventSequence;
		},
	) {}
	get sessionId() {
		return this.input.sessionId;
	}
	get sequence() {
		return this.input.sequence;
	}
}
export class SessionShutdownEvent {
	readonly type = "session_shutdown";
	constructor(
		readonly input: {
			readonly sessionId: PlotSessionId;
			readonly sequence: PlotSessionEventSequence;
		},
	) {}
	get sessionId() {
		return this.input.sessionId;
	}
	get sequence() {
		return this.input.sequence;
	}
}
export class ObservationSubmittedEvent {
	readonly type = "observation_submitted";
	readonly sessionId!: PlotSessionId;
	readonly sequence!: PlotSessionEventSequence;
	readonly observation!: Observation;
	constructor(input: Omit<ObservationSubmittedEvent, "type">) {
		Object.assign(this, input);
	}
}
export class PlotAgentEventEnvelope {
	readonly type = "plot_agent_event";
	readonly sessionId!: PlotSessionId;
	readonly sequence!: PlotSessionEventSequence;
	readonly event!: PlotAgentEvent;
	constructor(input: {
		readonly sessionId: PlotSessionId;
		readonly sequence: PlotSessionEventSequence;
		readonly event: PlotAgentEvent;
	}) {
		Object.assign(this, input);
	}
}
export class AgentSessionEventEnvelope {
	readonly type = "agent_session_event";
	readonly sessionId!: PlotSessionId;
	readonly sequence!: PlotSessionEventSequence;
	readonly sourceId!: string;
	readonly runId!: string;
	readonly workKey!: string;
	readonly subject?: SubjectKey;
	readonly eventType!: string;
	readonly event: unknown;
	constructor(input: Omit<AgentSessionEventEnvelope, "type">) {
		Object.assign(this, input);
	}
}
export type PlotSessionEvent =
	| SessionStartedEvent
	| SessionShutdownEvent
	| ObservationSubmittedEvent
	| PlotAgentEventEnvelope
	| AgentSessionEventEnvelope;
export class PlotSessionError extends Error {
	readonly phase = "setup";
	constructor(input: { readonly phase?: "setup"; readonly message: string }) {
		super(input.message);
		this.name = "PlotSessionError";
	}
}

interface AgentSessionRunnerConfig extends Omit<
	AgentSessionWorkRunnerOptions,
	"onEvent"
> {
	readonly onEvent?: (event: AgentSessionEvent) => Promise<void> | void;
	readonly wrapRunner?: (runner: WorkRunner) => WorkRunner;
	/** Extra prompt-template data merged over the work's template context. */
	readonly templateData?: (
		context: WorkRunnerContext,
	) => Promise<Record<string, unknown>> | Record<string, unknown>;
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
	readonly events: () => AsyncIterable<PlotSessionEvent>;
	readonly lastEventSequence: () => Promise<PlotSessionEventCursor>;
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
	readonly sessionHistory?: SessionHistoryStore;
}
export interface ExplicitRunnerPlotSessionLayerOptions extends BasePlotSessionLayerOptions {
	readonly runner: WorkRunner;
	readonly agentRunner?: never;
}
export interface AgentRunnerPlotSessionLayerOptions extends BasePlotSessionLayerOptions {
	readonly runner?: never;
	readonly agentRunner: AgentSessionRunnerConfig;
	readonly client?: AgentSessionClientShape;
}
export type PlotSessionLayerOptions =
	| ExplicitRunnerPlotSessionLayerOptions
	| AgentRunnerPlotSessionLayerOptions;
const ensureOneRunner = (options: PlotSessionLayerOptions) => {
	const n =
		(options.runner === undefined ? 0 : 1) +
		(options.agentRunner === undefined ? 0 : 1);
	if (n !== 1)
		throw new PlotSessionError({
			message: "exactly one of runner or agentRunner is required",
		});
};
const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);
const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };
const nextSequence = (get: () => number, set: (n: number) => void) => {
	const next = get() + 1;
	set(next);
	return plotSessionEventSequence(next);
};
const historyForPlotAgentEvent = (
	event: PlotAgentEvent,
): SessionHistoryAppendInput => {
	if (event.type === "tick_started")
		return { type: "tick_started", payload: { tickId: event.tickId } };
	if (event.type === "tick_completed")
		return { type: "tick_completed", payload: { result: event.result } };
	if (event.type === "wake_scheduled")
		return { type: "wake_scheduled", payload: event };
	if (event.type === "work_started")
		return { type: "work_started", payload: { run: event.run } };
	return { type: "work_completed", payload: { completion: event.completion } };
};
const resolveValue = async <A>(
	value: A | ((context: WorkRunnerContext) => Promise<A> | A),
	context: WorkRunnerContext,
): Promise<A> =>
	typeof value === "function"
		? (value as (context: WorkRunnerContext) => Promise<A> | A)(context)
		: value;
const makeAgentRunner = (
	client: AgentSessionClientShape,
	config: AgentSessionRunnerConfig,
	publishAgentEvent: (
		context: WorkRunnerContext,
		event: AgentSessionEvent,
	) => Promise<void>,
): WorkRunner => ({
	run: async (context): Promise<WorkResult> => {
		const promptTemplate = await resolveValue(config.prompt, context);
		const extraTemplateData =
			config.templateData === undefined
				? {}
				: await config.templateData(context);
		const prompt = await renderPromptTemplate(promptTemplate, {
			...makePromptTemplateData(context),
			...extraTemplateData,
		});
		const create =
			config.create === undefined
				? undefined
				: await resolveValue(config.create, context);
		const promptOptions =
			config.promptOptions === undefined
				? undefined
				: await resolveValue(config.promptOptions, context);
		const request: PromptAgentSessionOptions = {
			prompt,
			...(create === undefined ? {} : { create }),
			...(promptOptions === undefined ? {} : { promptOptions }),
			log: {
				source_id: context.sourceId,
				run_id: context.run.runId,
				work_key: context.work.workKey,
				tick_id: context.tickId,
			},
		};
		// Throttled activity ping so the runtime's stall detection sees a
		// streaming agent session as alive without flooding the mailbox.
		let lastActivityPingMs = 0;
		for await (const event of client.prompt(request)) {
			const now = Date.now();
			if (now - lastActivityPingMs >= 10_000) {
				lastActivityPingMs = now;
				await context.emitObservation({ type: "agent_session.activity" });
			}
			await publishAgentEvent(context, event);
			if (config.onEvent) {
				try {
					await config.onEvent(event);
				} catch (error) {
					await logWideEvent(
						{
							operation: "plot_session.agent_event_listener",
							outcome: "error",
							error: errorMessage(error),
							event_type: event.type,
							source_id: context.sourceId,
							run_id: context.run.runId,
							work_key: context.work.workKey,
						},
						"error",
					);
				}
			}
		}
		return {};
	},
});
export function makePlotSessionLayer(
	options: ExplicitRunnerPlotSessionLayerOptions,
): PlotSessionShape;
export function makePlotSessionLayer(
	options: AgentRunnerPlotSessionLayerOptions,
): PlotSessionShape;
export function makePlotSessionLayer(
	options: PlotSessionLayerOptions,
): PlotSessionShape {
	ensureOneRunner(options);
	const sessionId = options.id ?? plotSessionId("default");
	const eventCapacity = options.eventCapacity ?? 256;
	if (!Number.isInteger(eventCapacity) || eventCapacity < 1)
		throw new PlotSessionError({
			message: "eventCapacity must be a positive integer",
		});
	const events = new EventHub<PlotSessionEvent>(eventCapacity);
	let sequence = 0;
	const publish = (event: PlotSessionEvent) => events.publish(event);
	const claimMemorySequence = () =>
		nextSequence(
			() => sequence,
			(n) => {
				sequence = n;
			},
		);
	const claimHistorySequence = async (
		historyEvent: SessionHistoryAppendInput,
	) => {
		if (!options.sessionHistory) return claimMemorySequence();
		const appended = await options.sessionHistory.append(historyEvent);
		sequence = Number(appended.sequence);
		return plotSessionEventSequence(sequence);
	};
	const publishAgentEvent = async (
		context: WorkRunnerContext,
		event: AgentSessionEvent,
	) =>
		publish(
			new AgentSessionEventEnvelope({
				sessionId,
				sequence: options.sessionHistory
					? await claimHistorySequence({
							type: "agent_run_event",
							payload: {
								sourceId: context.sourceId,
								runId: context.run.runId,
								workKey: context.work.workKey,
								...optionalSubject(context.work.subject),
								eventType: event.type,
								event,
							},
						})
					: claimMemorySequence(),
				sourceId: context.sourceId,
				runId: context.run.runId,
				workKey: context.work.workKey,
				...optionalSubject(context.work.subject),
				eventType: event.type,
				event,
			}),
		);
	const runner =
		options.runner ??
		(() => {
			if (!options.client)
				throw new PlotSessionError({ message: "agentRunner requires client" });
			const r = makeAgentRunner(
				options.client,
				options.agentRunner,
				publishAgentEvent,
			);
			return options.agentRunner.wrapRunner
				? options.agentRunner.wrapRunner(r)
				: r;
		})();
	const plotAgent: PlotAgentShape = makePlotAgentLayer({
		...options.agent,
		sources: options.sources,
		runner,
	});
	void (async () => {
		for await (const event of plotAgent.events())
			publish(
				new PlotAgentEventEnvelope({
					sessionId,
					sequence: options.sessionHistory
						? await claimHistorySequence(historyForPlotAgentEvent(event))
						: claimMemorySequence(),
					event,
				}),
			);
	})();
	return {
		id: sessionId,
		workflow: options.workflow,
		start: async () =>
			withWideEvent(
				"plot_session.start",
				{ session_id: sessionId },
				async () => {
					publish(
						new SessionStartedEvent({
							sessionId,
							sequence: options.sessionHistory
								? await claimHistorySequence({
										type: "session_started",
										payload: {},
									})
								: claimMemorySequence(),
						}),
					);
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
						publish(
							new ObservationSubmittedEvent({
								sessionId,
								sequence: options.sessionHistory
									? await claimHistorySequence({
											type: "observation_submitted",
											payload: { observation },
										})
									: claimMemorySequence(),
								observation,
							}),
						);
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
			plotSessionEventCursor(
				options.sessionHistory
					? (await options.sessionHistory.frontier()).lastSequence
					: sequence,
			),
		shutdown: async () =>
			withWideEvent(
				"plot_session.shutdown",
				{ session_id: sessionId },
				async () => {
					const accepted = await plotAgent.shutdown();
					publish(
						new SessionShutdownEvent({
							sessionId,
							sequence: options.sessionHistory
								? await claimHistorySequence({
										type: "session_shutdown",
										payload: {},
									})
								: claimMemorySequence(),
						}),
					);
					return accepted;
				},
			),
	};
}
