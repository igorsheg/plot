import { EventHub } from "@plot/common/event-stream";
import { isRecord } from "@plot/common/primitives";
import { createAgent, type Agent } from "@plot/agent/agent";
import type { AgentEvent, SourceRecord } from "@plot/agent/model";
import type { WorkRunner } from "@plot/agent/work-runner";
import type { WorkflowConfig } from "@plot/sdk";
import type { OperatorObservationInput } from "@plot/sdk/work-contract";
import type {
	SourceActionInput,
	SourceActionStartResult,
	SourceActionState,
} from "@plot/sdk/runtime-contract";
import type {
	ExtensionSource,
	SourceActionEvents,
} from "./extension-source.js";

const LIVE_EVENT_CAPACITY = 256;

type SourceActionRunIdentity = Pick<SourceActionState, "actionRunId">;
type SourceActionSourceIdentity = SourceActionRunIdentity &
	Pick<SourceActionInput, "sourceId">;

export type SessionEvent =
	| AgentEvent
	| { readonly type: "session_started" }
	| { readonly type: "session_shutdown" }
	| ({ readonly type: "source_action_started" } & SourceActionRunIdentity &
			SourceActionInput)
	| ({
			readonly type: "source_action_progress";
			readonly message: string;
	  } & SourceActionRunIdentity)
	| ({
			readonly type: "source_interaction_open_url";
			readonly url: string;
			readonly fallbackText?: string;
	  } & SourceActionRunIdentity)
	| ({
			readonly type: "source_action_completed";
			readonly source: SourceRecord;
	  } & SourceActionRunIdentity)
	| ({
			readonly type: "source_action_failed";
			readonly message: string;
	  } & SourceActionSourceIdentity)
	| ({ readonly type: "source_action_cancelled" } & SourceActionSourceIdentity);

interface RuntimeEventRecord {
	readonly sessionId: string;
	readonly sequence: number;
	readonly timestamp: string;
}

export interface SessionEventRecord extends RuntimeEventRecord {
	readonly kind: "session_event";
	readonly event: SessionEvent;
}

export interface AgentEventRecord extends RuntimeEventRecord {
	readonly kind: "agent_event";
	readonly sourceId: string;
	readonly runId: string;
	readonly workKey: string;
	readonly event: unknown;
}

export type RuntimeEvent = SessionEventRecord | AgentEventRecord;

export interface SessionEventStore {
	readonly append: (event: RuntimeEvent) => Promise<void>;
	readonly read: (after?: number) => AsyncIterable<RuntimeEvent>;
	readonly close: () => Promise<void>;
}

type UnsequencedRuntimeEvent = Omit<RuntimeEvent, "sequence">;

export type AgentEventInput = Omit<
	AgentEventRecord,
	"kind" | "sessionId" | "sequence" | "timestamp"
>;

export type { OperatorObservationInput } from "@plot/sdk/work-contract";
export type {
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/sdk/runtime-contract";

type EventOwnerLifecycle =
	| { readonly state: "open" }
	| { readonly state: "closing"; readonly done: Promise<void> }
	| { readonly state: "closed" };

export const makeSessionEventOwner = (input: {
	readonly id: string;
	readonly store: SessionEventStore;
}) => {
	const live = new EventHub<RuntimeEvent>(LIVE_EVENT_CAPACITY);
	const listeners = new Set<(event: RuntimeEvent) => void>();
	let sequence = 0;
	let appends: Promise<unknown> = Promise.resolve();
	let lifecycle: EventOwnerLifecycle = { state: "open" };
	const append = (record: UnsequencedRuntimeEvent): Promise<RuntimeEvent> => {
		if (lifecycle.state !== "open")
			return Promise.reject(new Error("Session event owner is closed"));
		const operation = appends.then(async () => {
			const event = { ...record, sequence: ++sequence } as RuntimeEvent;
			await input.store.append(event);
			for (const listener of listeners) listener(event);
			live.publish(event);
			return event;
		});
		appends = operation;
		return operation;
	};
	return {
		id: input.id,
		store: input.store,
		subscribe: (listener: (event: RuntimeEvent) => void) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
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
		close: async () => {
			if (lifecycle.state === "closed") return;
			if (lifecycle.state === "closing") return lifecycle.done;
			const done = (async () => {
				await appends;
				await input.store.close();
				listeners.clear();
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
	ExtensionSource,
	| "source"
	| "startAction"
	| "cancelAction"
	| "resolveOperatorAction"
	| "shutdown"
>;

export interface SessionRuntime {
	readonly id: string;
	readonly start: () => Promise<void>;
	readonly tickOnce: Agent["tickOnce"];
	readonly recordOperatorObservation: (
		input: OperatorObservationInput,
	) => boolean;
	readonly startSourceAction: (
		input: SourceActionInput,
	) => Promise<SourceActionStartResult>;
	readonly cancelSourceAction: (actionRunId: string) => boolean;
	readonly events: (signal?: AbortSignal) => AsyncIterable<RuntimeEvent>;
	readonly shutdown: () => Promise<void>;
}

export interface SessionRuntimeOptions extends WorkflowConfig {
	readonly events: SessionEventOwner;
	readonly source: SessionSource;
	readonly runner: WorkRunner;
}

type RuntimeLifecycle =
	| { readonly state: "new" }
	| { readonly state: "running" }
	| { readonly state: "closing"; readonly done: Promise<void> }
	| { readonly state: "closed" };

export const makeSessionRuntime = (
	options: SessionRuntimeOptions,
): SessionRuntime => {
	let lifecycle: RuntimeLifecycle = { state: "new" };
	const agent: Agent = createAgent({
		source: options.source.source,
		runner: options.runner,
		event: options.events.appendSessionEvent,
		tickIntervalMs: options.tickIntervalMs,
		maxRunDurationMs: options.maxRunDurationMs,
		stallTimeoutMs: options.stallTimeoutMs,
	});
	const assertRunning = (operation: string) => {
		if (lifecycle.state !== "running")
			throw new Error(`cannot ${operation}: Session is ${lifecycle.state}`);
	};
	const sourceActionEvents = (
		input: SourceActionInput,
	): SourceActionEvents => ({
		started: (actionRunId) =>
			options.events.appendSessionEvent({
				type: "source_action_started",
				actionRunId,
				sourceId: input.sourceId,
				requirementId: input.requirementId,
				actionId: input.actionId,
			}),
		progress: (actionRunId, message) =>
			options.events.appendSessionEvent({
				type: "source_action_progress",
				actionRunId,
				message,
			}),
		openUrl: (actionRunId, url, fallbackText) =>
			options.events.appendSessionEvent(
				fallbackText === undefined
					? { type: "source_interaction_open_url", actionRunId, url }
					: {
							type: "source_interaction_open_url",
							actionRunId,
							url,
							fallbackText,
						},
			),
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
			agent.wake();
		},
		failed: (actionRunId, message) =>
			options.events.appendSessionEvent({
				type: "source_action_failed",
				actionRunId,
				sourceId: input.sourceId,
				message,
			}),
		cancelled: (actionRunId) =>
			options.events.appendSessionEvent({
				type: "source_action_cancelled",
				actionRunId,
				sourceId: input.sourceId,
			}),
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
			return agent.tickOnce();
		},
		recordOperatorObservation: (input) => {
			assertRunning("record an operator observation");
			const observation = options.source.resolveOperatorAction(input);
			if (observation === undefined) return false;
			return agent.offerOperatorObservation({
				...observation,
				timestamp: new Date().toISOString(),
			});
		},
		startSourceAction: async (input) => {
			assertRunning("start a Source action");
			if (options.source.source.initial.sourceId !== input.sourceId)
				return { accepted: false };
			return options.source.startAction({
				requirementId: input.requirementId,
				actionId: input.actionId,
				events: sourceActionEvents(input),
			});
		},
		cancelSourceAction: (actionRunId) => {
			assertRunning("cancel a Source action");
			return options.source.cancelAction(actionRunId);
		},
		events: options.events.events,
		shutdown: async () => {
			if (lifecycle.state === "closed") return;
			if (lifecycle.state === "closing") return lifecycle.done;
			const done = (async () => {
				try {
					await agent.shutdown();
					await options.source.shutdown();
					await options.events.appendSessionEvent({ type: "session_shutdown" });
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
		comment?: string;
		clientId?: string;
		actor?: string;
	} = {
		sourceId: text(value["sourceId"], "sourceId"),
		workKey: text(value["workKey"], "workKey"),
		actionId: text(value["actionId"], "actionId"),
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
