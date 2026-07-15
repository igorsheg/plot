import { EventHub } from "@plot/common/event-stream";
import { isRecord } from "@plot/common/primitives";
import { makePlotAgent, type PlotAgent } from "@plot/agent/agent";
import type {
	Completion,
	Diagnostic,
	PlotAgentEvent,
	SourceRecord,
	TickResult,
	WorkRecord,
	WorkRun,
} from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type {
	PlotExtensionSourceBundle,
	SourceActionEvents,
	SourceActionStartResult,
} from "./extension-source.js";
import { createSessionEventLogWriter } from "./history.js";

const LIVE_EVENT_CAPACITY = 256;

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
	| { readonly type: "source_observed"; readonly source: SourceRecord }
	| {
			readonly type: "source_action_started";
			readonly actionRunId: string;
			readonly sourceId: string;
			readonly requirementId: string;
			readonly actionId: string;
	  }
	| {
			readonly type: "source_action_progress";
			readonly actionRunId: string;
			readonly message: string;
	  }
	| {
			readonly type: "source_interaction_open_url";
			readonly actionRunId: string;
			readonly url: string;
			readonly fallbackText?: string;
	  }
	| {
			readonly type: "source_action_completed";
			readonly actionRunId: string;
			readonly source: SourceRecord;
	  }
	| {
			readonly type: "source_action_failed";
			readonly actionRunId: string;
			readonly sourceId: string;
			readonly message: string;
	  }
	| {
			readonly type: "source_action_cancelled";
			readonly actionRunId: string;
			readonly sourceId: string;
	  }
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

export interface SourceActionInput {
	readonly sourceId: string;
	readonly requirementId: string;
	readonly actionId: string;
}

export type { SourceActionStartResult } from "./extension-source.js";

export interface OperatorObservationInput {
	readonly sourceId: string;
	readonly workKey: string;
	readonly actionId: string;
	readonly actionLabel: string;
	readonly comment?: string;
	readonly clientId?: string;
	readonly actor?: string;
}

type EventOwnerLifecycle =
	| { readonly state: "open" }
	| { readonly state: "closing"; readonly done: Promise<void> }
	| { readonly state: "closed" };

export const makeSessionEventOwner = (input: {
	readonly id: string;
	readonly sessionFile: string;
}) => {
	const live = new EventHub<RuntimeEvent>(LIVE_EVENT_CAPACITY);
	const history = createSessionEventLogWriter(input.sessionFile);
	let sequence = 0;
	let appends: Promise<unknown> = Promise.resolve();
	let lifecycle: EventOwnerLifecycle = { state: "open" };
	const append = (record: UnsequencedRuntimeEvent): Promise<RuntimeEvent> => {
		if (lifecycle.state !== "open")
			return Promise.reject(new Error("Session event owner is closed"));
		const operation = appends.then(async () => {
			const event = { ...record, sequence: ++sequence } as RuntimeEvent;
			await history.append(event);
			live.publish(event);
			return event;
		});
		appends = operation;
		return operation;
	};
	return {
		id: input.id,
		sessionFile: input.sessionFile,
		appendSessionEvent: (event: SessionEvent) =>
			append({
				kind: "session_event",
				sessionId: input.id,
				timestamp: new Date().toISOString(),
				event,
			}),
		appendAgentEvent: (event: AgentEventInput) =>
			append({
				kind: "agent_event",
				sessionId: input.id,
				timestamp: new Date().toISOString(),
				...event,
			}),
		events: (signal?: AbortSignal) => live.subscribe(signal),
		flush: async () => {
			await appends;
		},
		close: async () => {
			if (lifecycle.state === "closed") return;
			if (lifecycle.state === "closing") return lifecycle.done;
			const done = (async () => {
				await appends;
				await history.close();
				live.close();
				lifecycle = { state: "closed" };
			})();
			lifecycle = { state: "closing", done };
			return done;
		},
	};
};

export type SessionEventOwner = ReturnType<typeof makeSessionEventOwner>;

export type SessionSource = Pick<
	PlotExtensionSourceBundle,
	"source" | "startAction" | "cancelAction" | "shutdown"
>;

export interface SessionRuntime {
	readonly id: string;
	readonly start: () => Promise<void>;
	readonly tickOnce: () => Promise<TickSummary>;
	readonly recordOperatorObservation: (
		input: OperatorObservationInput,
	) => Promise<boolean>;
	readonly startSourceAction: (
		input: SourceActionInput,
	) => Promise<SourceActionStartResult>;
	readonly cancelSourceAction: (actionRunId: string) => Promise<boolean>;
	readonly events: (signal?: AbortSignal) => AsyncIterable<RuntimeEvent>;
	readonly shutdown: () => Promise<boolean>;
}

export interface SessionRuntimeOptions {
	readonly events: SessionEventOwner;
	readonly source: SessionSource;
	readonly runner: WorkRunner;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stallTimeoutMs?: number;
}

const tickSummary = (result: TickResult): TickSummary => ({
	tickId: result.tickId,
	selected: result.selected,
	started: result.started,
	running: result.running,
	completions: result.completions,
	diagnostics: result.diagnostics,
});

const sessionEvent = (event: PlotAgentEvent): SessionEvent =>
	event.type === "tick_completed"
		? { type: "tick_completed", result: tickSummary(event.result) }
		: event;

type RuntimeLifecycle =
	| { readonly state: "new" }
	| { readonly state: "running" }
	| { readonly state: "closing"; readonly done: Promise<boolean> }
	| { readonly state: "closed" };

export const makeSessionRuntime = (
	options: SessionRuntimeOptions,
): SessionRuntime => {
	let lifecycle: RuntimeLifecycle = { state: "new" };
	const agentOptions: Parameters<typeof makePlotAgent>[0] = {
		source: options.source.source,
		runner: options.runner,
		event: async (event) => {
			await options.events.appendSessionEvent(sessionEvent(event));
		},
	};
	if (options.tickIntervalMs !== undefined)
		(agentOptions as { tickIntervalMs?: number }).tickIntervalMs =
			options.tickIntervalMs;
	if (options.maxRunDurationMs !== undefined)
		(agentOptions as { maxRunDurationMs?: number }).maxRunDurationMs =
			options.maxRunDurationMs;
	if (options.stallTimeoutMs !== undefined)
		(agentOptions as { stallTimeoutMs?: number }).stallTimeoutMs =
			options.stallTimeoutMs;
	const agent: PlotAgent = makePlotAgent(agentOptions);
	const assertRunning = (operation: string) => {
		if (lifecycle.state !== "running")
			throw new Error(`cannot ${operation}: Session is ${lifecycle.state}`);
	};
	const sourceActionEvents = (
		input: SourceActionInput,
	): SourceActionEvents => ({
		started: async (actionRunId) => {
			await options.events.appendSessionEvent({
				type: "source_action_started",
				actionRunId,
				sourceId: input.sourceId,
				requirementId: input.requirementId,
				actionId: input.actionId,
			});
		},
		progress: async (actionRunId, message) => {
			await options.events.appendSessionEvent({
				type: "source_action_progress",
				actionRunId,
				message,
			});
		},
		openUrl: async (actionRunId, url, fallbackText) => {
			if (fallbackText === undefined) {
				await options.events.appendSessionEvent({
					type: "source_interaction_open_url",
					actionRunId,
					url,
				});
				return;
			}
			await options.events.appendSessionEvent({
				type: "source_interaction_open_url",
				actionRunId,
				url,
				fallbackText,
			});
		},
		completed: async (actionRunId, source) => {
			await options.events.appendSessionEvent({
				type: "source_action_completed",
				actionRunId,
				source,
			});
			await options.events.appendSessionEvent({
				type: "source_observed",
				source,
			});
			await agent.wakeAfter(1, "Source setup completed");
		},
		failed: async (actionRunId, message) => {
			await options.events.appendSessionEvent({
				type: "source_action_failed",
				actionRunId,
				sourceId: input.sourceId,
				message,
			});
		},
		cancelled: async (actionRunId) => {
			await options.events.appendSessionEvent({
				type: "source_action_cancelled",
				actionRunId,
				sourceId: input.sourceId,
			});
		},
	});
	return {
		id: options.events.id,
		start: async () => {
			if (lifecycle.state === "running") return;
			if (lifecycle.state !== "new")
				throw new Error(`cannot start Session while ${lifecycle.state}`);
			await options.events.appendSessionEvent({ type: "session_started" });
			await agent.start();
			lifecycle = { state: "running" };
		},
		tickOnce: async () => {
			assertRunning("tick");
			const result = await agent.tickOnce();
			await options.events.flush();
			return tickSummary(result);
		},
		recordOperatorObservation: async (input) => {
			assertRunning("record an operator observation");
			return agent.offerObservation({
				type: "operator_observation",
				data: { ...input, timestamp: new Date().toISOString() },
			});
		},
		startSourceAction: async (input) => {
			assertRunning("start a Source action");
			if (options.source.source.id !== input.sourceId)
				return { accepted: false };
			return options.source.startAction({
				requirementId: input.requirementId,
				actionId: input.actionId,
				events: sourceActionEvents(input),
			});
		},
		cancelSourceAction: async (actionRunId) => {
			assertRunning("cancel a Source action");
			return options.source.cancelAction(actionRunId);
		},
		events: options.events.events,
		shutdown: async () => {
			if (lifecycle.state === "closed") return true;
			if (lifecycle.state === "closing") return lifecycle.done;
			const done = (async () => {
				try {
					await agent.shutdown();
					await options.source.shutdown();
					await options.events.appendSessionEvent({ type: "session_shutdown" });
					await options.events.flush();
					return true;
				} finally {
					await options.events.close();
					lifecycle = { state: "closed" };
				}
			})();
			lifecycle = { state: "closing", done };
			return done;
		},
	};
};

const text = (value: unknown, name: string): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(`${name} must be a non-empty string`);
};

const sequence = (value: unknown): number => {
	if (typeof value === "number" && Number.isInteger(value) && value > 0)
		return value;
	throw new Error("RuntimeEvent sequence must be a positive integer");
};

const sessionEventTypes = new Set<SessionEvent["type"]>([
	"session_started",
	"session_shutdown",
	"tick_started",
	"tick_completed",
	"source_observed",
	"source_action_started",
	"source_action_progress",
	"source_interaction_open_url",
	"source_action_completed",
	"source_action_failed",
	"source_action_cancelled",
	"work_observed",
	"work_removed",
	"wake_scheduled",
	"attempt_started",
	"attempt_completed",
]);

export const decodeOperatorObservation = (
	value: unknown,
): OperatorObservationInput => {
	if (!isRecord(value))
		throw new Error("Operator Observation must be an object");
	const result: {
		sourceId: string;
		workKey: string;
		actionId: string;
		actionLabel: string;
		comment?: string;
		clientId?: string;
		actor?: string;
	} = {
		sourceId: text(value["sourceId"], "sourceId"),
		workKey: text(value["workKey"], "workKey"),
		actionId: text(value["actionId"], "actionId"),
		actionLabel: text(value["actionLabel"], "actionLabel"),
	};
	for (const key of ["comment", "clientId", "actor"] as const) {
		const field = value[key];
		if (field !== undefined && typeof field !== "string")
			throw new Error(`${key} must be a string`);
		if (field !== undefined) result[key] = field;
	}
	return result;
};

export const decodeSourceActionInput = (value: unknown): SourceActionInput => {
	if (!isRecord(value)) throw new Error("Source action must be an object");
	return {
		sourceId: text(value["sourceId"], "sourceId"),
		requirementId: text(value["requirementId"], "requirementId"),
		actionId: text(value["actionId"], "actionId"),
	};
};

/** Validate a RuntimeEvent once when it crosses a process boundary. */
export const decodeRuntimeEvent = (value: unknown): RuntimeEvent => {
	if (!isRecord(value)) throw new Error("RuntimeEvent must be an object");
	const base = {
		sessionId: text(value["sessionId"], "RuntimeEvent sessionId"),
		sequence: sequence(value["sequence"]),
		timestamp: text(value["timestamp"], "RuntimeEvent timestamp"),
	};
	if (value["kind"] === "agent_event") {
		return {
			kind: "agent_event",
			...base,
			sourceId: text(value["sourceId"], "Agent event sourceId"),
			runId: text(value["runId"], "Agent event runId"),
			workKey: text(value["workKey"], "Agent event workKey"),
			event: value["event"],
		};
	}
	if (value["kind"] !== "session_event" || !isRecord(value["event"]))
		throw new Error("invalid RuntimeEvent kind");
	const type = value["event"]["type"];
	if (
		typeof type !== "string" ||
		!sessionEventTypes.has(type as SessionEvent["type"])
	)
		throw new Error("invalid Session event type");
	return {
		kind: "session_event",
		...base,
		event: value["event"] as unknown as SessionEvent,
	};
};
