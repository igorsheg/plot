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

interface CurrentOperatorActionDeclaration {
	readonly action: OperatorAction;
	readonly sourceId: string;
	readonly workDisplay?: unknown;
	readonly workVersion?: string;
}

export interface ControlSessionRuntime {
	readonly sessionId: string;
	readonly epoch: string;
	readonly session: PlotSessionShape;
	readonly history?: SessionHistoryStore;
	readonly isPaused: () => boolean;
	readonly isClosing: () => boolean;
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
	readonly recordControlEvent: (
		type: string,
		payload?: unknown,
	) => Promise<SessionHistoryEvent>;
	readonly recordOperatorObservation: (
		observation: OperatorObservation,
	) => Promise<SessionHistoryEvent>;
	readonly currentOperatorAction: (input: {
		readonly workKey: string;
		readonly actionId: string;
	}) => Promise<CurrentOperatorActionDeclaration | undefined>;
}

export interface ControlSessionRegistry {
	readonly register: (runtime: ControlSessionRuntime) => Promise<void>;
	readonly unregister: (sessionId: string) => Promise<void>;
	readonly get: (sessionId: string) => ControlSessionRuntime | undefined;
	readonly list: () => readonly ControlSessionRuntime[];
	readonly summary: (
		sessionId: string,
	) => Promise<PlotSessionSummary | undefined>;
	readonly summaries: () => Promise<readonly PlotSessionSummary[]>;
	readonly rosterEvents: () => AsyncIterable<{
		readonly type: "session_opened" | "session_changed" | "session_closed";
		readonly session: PlotSessionSummary;
	}>;
	readonly attach: (input: {
		readonly sessionId: string;
		readonly connectionId: string;
		readonly role: "observer" | "controller";
	}) => Promise<void>;
	readonly detach: (input: {
		readonly sessionId: string;
		readonly connectionId: string;
	}) => Promise<void>;
	readonly detachConnection: (connectionId: string) => Promise<void>;
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

const actionsFromSnapshot = (snapshot: RuntimeSnapshot) => {
	const latest = new Map<string, readonly OperatorAction[]>();
	for (const run of snapshot.running.values()) {
		const actions = (run as { readonly operatorActions?: unknown })
			.operatorActions;
		if (Array.isArray(actions)) latest.set(run.workKey, actions);
	}
	return latest;
};

const needsYouCountFrom = (
	snapshot: RuntimeSnapshot,
	events: readonly SessionHistoryEvent[],
) => {
	const latest = actionsFromSnapshot(snapshot);
	for (const event of events) {
		if (event.type !== "operator_actions_declared") continue;
		if (!isRecord(event.payload)) continue;
		const workKey = event.payload["workKey"];
		const actions = event.payload["actions"];
		if (typeof workKey !== "string" || !Array.isArray(actions)) continue;
		if (!latest.has(workKey))
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
	let closing = false;
	let closed = false;
	let closePromise: Promise<boolean> | undefined;
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
		isClosing: () => closing,
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
			if (closePromise !== undefined) return closePromise;
			closing = true;
			closePromise = (async () => {
				await appendControlEvent("session_close_requested");
				const accepted = await options.session.shutdown();
				closed = true;
				await appendControlEvent("session_close_completed", { accepted });
				eventHub.close();
				return accepted;
			})();
			return closePromise;
		},
		requestTick: async () => {
			await appendControlEvent("tick_requested");
			return options.session.tickOnce();
		},
		interruptAgentRun: async (input) => {
			const snapshot = await options.session.snapshot();
			const run = [...snapshot.running.values()].find(
				(candidate) =>
					candidate.runId === input.runId &&
					(input.workKey === undefined || candidate.workKey === input.workKey),
			);
			if (!run) return false;
			await appendControlEvent("agent_run_interrupt_requested", {
				runId: input.runId,
				workKey: input.workKey ?? run.workKey,
				sourceId: run.sourceId,
			});
			const accepted = await options.session.interruptAgentRun(input);
			await appendControlEvent("agent_run_interrupt_completed", {
				runId: input.runId,
				workKey: input.workKey ?? run.workKey,
				accepted,
			});
			return accepted;
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
					: closing
						? "stopping"
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
				needsYouCount: needsYouCountFrom(snapshot, events),
				tokenThroughputPerSecond: null,
				totalTokens: 0,
				lastActivityAt: null,
				attachments,
			};
		},
		recordControlEvent: (type, payload) => appendControlEvent(type, payload),
		recordOperatorObservation: async (observation) => {
			const event = await appendControlEvent(
				"operator_observation_recorded",
				observation,
			);
			const accepted = await options.session.submitObservation({
				type: "operator_observation",
				data: observation,
			});
			if (!accepted) {
				await appendControlEvent("operator_observation_submit_rejected", {
					workKey: observation.workKey,
					actionId: observation.actionId,
				});
				throw new Error(
					"operator observation was recorded but not accepted by the Plot loop",
				);
			}
			return event;
		},
		currentOperatorAction: async (input) => {
			const snapshot = await options.session.snapshot();
			const run = snapshot.running.get(input.workKey);
			if (!run) return undefined;
			const actions = (run as { readonly operatorActions?: unknown })
				.operatorActions;
			if (!Array.isArray(actions)) return undefined;
			const action = (actions as readonly OperatorAction[]).find(
				(candidate) => candidate.id === input.actionId,
			);
			if (!action) return undefined;
			const display = (run as { readonly display?: unknown }).display;
			const version = isRecord(display) ? display["version"] : undefined;
			return {
				action,
				sourceId: run.sourceId,
				...(display === undefined ? {} : { workDisplay: display }),
				...(typeof version === "string" ? { workVersion: version } : {}),
			};
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
	const attachments = new Map<string, Map<string, "observer" | "controller">>();
	const countsFor = (sessionId: string) => {
		const roles = attachments.get(sessionId);
		if (!roles) return { observers: 0, controllers: 0 };
		let observers = 0;
		let controllers = 0;
		for (const role of roles.values()) {
			if (role === "controller") controllers += 1;
			else observers += 1;
		}
		return { observers, controllers };
	};
	const removeEmptyAttachmentSet = (sessionId: string) => {
		const roles = attachments.get(sessionId);
		if (roles !== undefined && roles.size === 0) attachments.delete(sessionId);
	};
	const publishChanged = async (sessionId: string) => {
		const runtime = sessions.get(sessionId);
		if (!runtime) return;
		roster.publish({
			type: "session_changed",
			session: await runtime.summary(countsFor(sessionId)),
		});
	};
	return {
		register: async (runtime) => {
			sessions.set(runtime.sessionId, runtime);
			roster.publish({
				type: "session_opened",
				session: await runtime.summary(countsFor(runtime.sessionId)),
			});
		},
		unregister: async (sessionId) => {
			const runtime = sessions.get(sessionId);
			if (!runtime) return;
			const session = await runtime.summary(countsFor(sessionId));
			sessions.delete(sessionId);
			attachments.delete(sessionId);
			roster.publish({ type: "session_closed", session });
		},
		get: (sessionId) => sessions.get(sessionId),
		list: () => [...sessions.values()],
		summary: async (sessionId) => {
			const runtime = sessions.get(sessionId);
			return runtime?.summary(countsFor(sessionId));
		},
		summaries: () =>
			Promise.all(
				[...sessions.values()].map((runtime) =>
					runtime.summary(countsFor(runtime.sessionId)),
				),
			),
		rosterEvents: () => roster.subscribe(),
		attach: async ({ sessionId, connectionId, role }) => {
			let roles = attachments.get(sessionId);
			if (roles === undefined) {
				roles = new Map();
				attachments.set(sessionId, roles);
			}
			roles.set(connectionId, role);
			await publishChanged(sessionId);
		},
		detach: async ({ sessionId, connectionId }) => {
			attachments.get(sessionId)?.delete(connectionId);
			removeEmptyAttachmentSet(sessionId);
			await publishChanged(sessionId);
		},
		detachConnection: async (connectionId) => {
			const changed: string[] = [];
			for (const [sessionId, roles] of attachments) {
				if (!roles.delete(connectionId)) continue;
				changed.push(sessionId);
				removeEmptyAttachmentSet(sessionId);
			}
			await Promise.all(changed.map((sessionId) => publishChanged(sessionId)));
		},
		publishChanged,
	};
};
