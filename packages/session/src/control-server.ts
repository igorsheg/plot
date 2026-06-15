import { basename } from "node:path";
import { EventHub } from "@plot/common/event-stream";
import type { RuntimeSnapshot } from "@plot/agent/model";
import type {
	OperatorAction,
	OperatorObservation,
} from "@plot/control/operator";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import type { PlotSessionShape } from "./plot-session.js";
import type { SessionHistoryStore } from "./session-history.js";

export interface ControlSessionRuntimeOptions {
	readonly session: PlotSessionShape;
	readonly history?: SessionHistoryStore;
	readonly cwd?: string;
	readonly workflowPath?: string;
	readonly mode?: "watch" | "oneshot";
	readonly eventCapacity?: number;
	readonly onChanged?: (summary: PlotSessionSummary) => Promise<void> | void;
}

export interface ControlSessionRuntime {
	readonly sessionId: string;
	readonly epoch: string;
	readonly session: PlotSessionShape;
	readonly history?: SessionHistoryStore;
	readonly isPaused: () => boolean;
	readonly isClosed: () => boolean;
	readonly pause: () => Promise<SessionHistoryEvent>;
	readonly resume: () => Promise<SessionHistoryEvent>;
	readonly close: () => Promise<boolean>;
	readonly requestTick: () => Promise<unknown>;
	readonly interruptAgentRun: (input: {
		readonly runId: string;
		readonly workKey?: string;
	}) => Promise<boolean>;
	readonly snapshot: () => Promise<RuntimeSnapshot>;
	readonly frontier: () => Promise<number>;
	readonly replayAfter: (
		afterSequence: number,
	) => Promise<readonly SessionHistoryEvent[]>;
	readonly events: () => AsyncIterable<SessionHistoryEvent>;
	readonly summary: (attachments?: {
		readonly observers: number;
		readonly controllers: number;
	}) => Promise<PlotSessionSummary>;
	readonly recordOperatorObservation: (
		observation: OperatorObservation,
	) => Promise<SessionHistoryEvent>;
	readonly currentOperatorAction: (input: {
		readonly workKey: string;
		readonly actionId: string;
	}) => Promise<OperatorAction | undefined>;
}

export interface ControlSessionRegistry {
	readonly register: (runtime: ControlSessionRuntime) => Promise<void>;
	readonly get: (sessionId: string) => ControlSessionRuntime | undefined;
	readonly list: () => readonly ControlSessionRuntime[];
	readonly rosterEvents: () => AsyncIterable<{
		readonly type: "session_opened" | "session_changed" | "session_closed";
		readonly session: PlotSessionSummary;
	}>;
	readonly publishChanged: (sessionId: string) => Promise<void>;
}

const nowIso = () => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const synthesizeHistoryEvent = (
	sessionId: string,
	epoch: string,
	sequence: number,
	type: string,
	payload: unknown = {},
): SessionHistoryEvent =>
	({
		sessionId,
		epoch,
		sequence,
		timestamp: nowIso(),
		type,
		payload,
	}) as SessionHistoryEvent;

const eventToHistoryFallback = (
	event: { readonly type?: unknown; readonly sequence?: unknown },
	sessionId: string,
	epoch: string,
): SessionHistoryEvent => {
	const sequence = typeof event.sequence === "number" ? event.sequence : 1;
	if (
		event.type === "plot_agent_event" &&
		isRecord((event as { readonly event?: unknown }).event)
	) {
		const agentEvent = (event as { readonly event: Record<string, unknown> })
			.event;
		if (agentEvent["type"] === "tick_started")
			return synthesizeHistoryEvent(
				sessionId,
				epoch,
				sequence,
				"tick_started",
				{
					tickId: agentEvent["tickId"],
				},
			);
		if (agentEvent["type"] === "tick_completed")
			return synthesizeHistoryEvent(
				sessionId,
				epoch,
				sequence,
				"tick_completed",
				{
					result: agentEvent["result"],
				},
			);
		if (agentEvent["type"] === "work_started")
			return synthesizeHistoryEvent(
				sessionId,
				epoch,
				sequence,
				"work_started",
				{
					run: agentEvent["run"],
				},
			);
		if (agentEvent["type"] === "work_completed")
			return synthesizeHistoryEvent(
				sessionId,
				epoch,
				sequence,
				"work_completed",
				{
					completion: agentEvent["completion"],
				},
			);
		if (agentEvent["type"] === "wake_scheduled")
			return synthesizeHistoryEvent(
				sessionId,
				epoch,
				sequence,
				"wake_scheduled",
				agentEvent,
			);
	}
	if (event.type === "agent_session_event")
		return synthesizeHistoryEvent(
			sessionId,
			epoch,
			sequence,
			"agent_run_event",
			event,
		);
	if (event.type === "observation_submitted")
		return synthesizeHistoryEvent(
			sessionId,
			epoch,
			sequence,
			"observation_submitted",
			{
				observation: (event as { readonly observation?: unknown }).observation,
			},
		);
	return synthesizeHistoryEvent(
		sessionId,
		epoch,
		sequence,
		String(event.type ?? "event"),
		{},
	);
};

const labelsFromWorkflow = (session: PlotSessionShape) => {
	const workflowPath = session.workflow.path ?? "WORKFLOW.md";
	const cwd = process.cwd();
	const workflowName = session.workflow.runtime.name ?? basename(workflowPath);
	return { workflowPath, cwd, workflowName, cwdName: basename(cwd) || cwd };
};

const readHistoryEventBySequence = async (
	history: SessionHistoryStore | undefined,
	sequence: number,
): Promise<SessionHistoryEvent | undefined> => {
	if (!history) return undefined;
	const all = await history.readAll();
	return all.events.find((event) => Number(event.sequence) === sequence);
};

const latestDeclaredActions = (
	events: readonly SessionHistoryEvent[],
	workKey: string,
): readonly OperatorAction[] => {
	for (const event of events.toReversed()) {
		if (event.type !== "operator_actions_declared") continue;
		if (!isRecord(event.payload) || event.payload["workKey"] !== workKey)
			continue;
		const actions = event.payload["actions"];
		if (Array.isArray(actions)) return actions as readonly OperatorAction[];
	}
	return [];
};

const needsYouCountFrom = (events: readonly SessionHistoryEvent[]) => {
	const latest = new Map<string, readonly OperatorAction[]>();
	for (const event of events) {
		if (event.type !== "operator_actions_declared") continue;
		if (!isRecord(event.payload)) continue;
		const workKey = event.payload["workKey"];
		const actions = event.payload["actions"];
		if (typeof workKey !== "string" || !Array.isArray(actions)) continue;
		latest.set(workKey, actions as readonly OperatorAction[]);
	}
	return [...latest.values()].filter((actions) =>
		actions.some((action) => !action.disabledReason),
	).length;
};

export const makeControlSessionRuntime = (
	options: ControlSessionRuntimeOptions,
): ControlSessionRuntime => {
	const eventHub = new EventHub<SessionHistoryEvent>(
		options.eventCapacity ?? 256,
	);
	const memoryEvents: SessionHistoryEvent[] = [];
	let paused = false;
	let closed = false;
	let memorySequence = 0;
	const sessionId = options.session.id;
	const epoch = options.history?.epoch ?? sessionId;
	const publish = async (event: SessionHistoryEvent) => {
		if (!options.history) memoryEvents.push(event);
		eventHub.publish(event);
		await options.onChanged?.(await runtime.summary());
	};
	const appendControlEvent = async (type: string, payload: unknown = {}) => {
		const event = options.history
			? await options.history.append({ type, payload })
			: synthesizeHistoryEvent(
					sessionId,
					epoch,
					++memorySequence,
					type,
					payload,
				);
		await publish(event);
		return event;
	};
	void (async () => {
		for await (const event of options.session.events()) {
			const sequence = Number(
				(event as { readonly sequence?: unknown }).sequence ?? 0,
			);
			const historyEvent =
				(await readHistoryEventBySequence(options.history, sequence)) ??
				eventToHistoryFallback(
					event as { readonly type?: unknown; readonly sequence?: unknown },
					sessionId,
					epoch,
				);
			if (!options.history)
				memorySequence = Math.max(
					memorySequence,
					Number(historyEvent.sequence),
				);
			await publish(historyEvent);
		}
	})();
	const runtime: ControlSessionRuntime = {
		sessionId,
		epoch,
		session: options.session,
		...(options.history === undefined ? {} : { history: options.history }),
		isPaused: () => paused,
		isClosed: () => closed,
		pause: async () => {
			paused = true;
			await options.session.pauseDispatch();
			return appendControlEvent("session_paused");
		},
		resume: async () => {
			paused = false;
			await options.session.resumeDispatch();
			return appendControlEvent("session_resumed");
		},
		close: async () => {
			closed = true;
			return options.session.shutdown();
		},
		requestTick: async () => options.session.tickOnce(),
		interruptAgentRun: async (input) => {
			const interrupt = options.session.interruptAgentRun;
			if (!interrupt) return false;
			return interrupt(input);
		},
		snapshot: () => options.session.snapshot(),
		frontier: async () =>
			options.history
				? (await options.history.frontier()).lastSequence
				: memorySequence,
		replayAfter: async (afterSequence) =>
			options.history
				? (await options.history.replayAfter(afterSequence)).events
				: memoryEvents.filter(
						(event) => Number(event.sequence) > afterSequence,
					),
		events: () => eventHub.subscribe(),
		summary: async (attachments = { observers: 0, controllers: 0 }) => {
			const labels = labelsFromWorkflow(options.session);
			const snapshot = await options.session.snapshot();
			const running = [...snapshot.running.values()];
			const events = options.history
				? (await options.history.readAll()).events
				: memoryEvents;
			return {
				id: sessionId,
				epoch,
				mode: options.mode ?? "watch",
				state: closed
					? "stopped"
					: paused
						? "paused"
						: running.length > 0
							? "acting"
							: "idle",
				workflowName: labels.workflowName,
				workflowPath: options.workflowPath ?? labels.workflowPath,
				cwd: options.cwd ?? labels.cwd,
				cwdName: basename(options.cwd ?? labels.cwd) || labels.cwdName,
				agents: { active: running.length, max: 100 },
				needsYouCount: needsYouCountFrom(events),
				tokenThroughputPerSecond: null,
				totalTokens: 0,
				lastActivityAt: null,
				attachments,
			};
		},
		recordOperatorObservation: (observation) =>
			appendControlEvent("operator_observation_recorded", observation),
		currentOperatorAction: async (input) => {
			const events = options.history
				? (await options.history.readAll()).events
				: memoryEvents;
			return latestDeclaredActions(events, input.workKey).find(
				(action) => action.id === input.actionId,
			);
		},
	};
	return runtime;
};

export const makeControlSessionRegistry = (): ControlSessionRegistry => {
	const sessions = new Map<string, ControlSessionRuntime>();
	const roster = new EventHub<{
		readonly type: "session_opened" | "session_changed" | "session_closed";
		readonly session: PlotSessionSummary;
	}>(256);
	const attachmentCounts = new Map<
		string,
		{ observers: number; controllers: number }
	>();
	const countsFor = (sessionId: string) =>
		attachmentCounts.get(sessionId) ?? { observers: 0, controllers: 0 };
	return {
		register: async (runtime) => {
			sessions.set(runtime.sessionId, runtime);
			roster.publish({
				type: "session_opened",
				session: await runtime.summary(countsFor(runtime.sessionId)),
			});
		},
		get: (sessionId) => sessions.get(sessionId),
		list: () => [...sessions.values()],
		rosterEvents: () => roster.subscribe(),
		publishChanged: async (sessionId) => {
			const runtime = sessions.get(sessionId);
			if (!runtime) return;
			roster.publish({
				type: runtime.isClosed() ? "session_closed" : "session_changed",
				session: await runtime.summary(countsFor(sessionId)),
			});
		},
	};
};
