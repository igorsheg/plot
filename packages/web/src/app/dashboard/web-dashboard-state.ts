// oxlint-disable no-await-in-loop no-unmodified-loop-condition -- reconnect owns sequential attempts and cleanup mutates the guard from React.
import {
	applySnapshot,
	emptyProjection,
	reduceSessionHistoryEvent,
	type DashboardProjection,
} from "@plot/control/projection";
import type { PlotCommand, PlotServerRecord } from "@plot/control/protocol";
import type { SessionHistoryEvent } from "@plot/control/session-history";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { useEffect, useState } from "react";
import {
	connectBrowserPlotControl,
	readBrowserControlHandoff,
	type BrowserPlotControlClient,
} from "./web-control-client";

export type ConnectionState =
	| "handoff-missing"
	| "connecting"
	| "online"
	| "offline";

export type ControlRole = "observer" | "controller";

export interface PlotWebDashboardState {
	readonly connection: ConnectionState;
	readonly roster: readonly PlotSessionSummary[];
	readonly selectedSessionId?: string | undefined;
	readonly projection?: DashboardProjection | undefined;
	readonly controlRole: ControlRole;
	readonly sendCommand?: (
		command: PlotCommand,
		params?: unknown,
	) => Promise<void>;
	readonly lastError?: string | undefined;
	readonly mutationError?: string | undefined;
	readonly snapshotUnavailable?: boolean | undefined;
}

// Internal slice the hook actually owns (transport-driven). `selectedSessionId`
// and `controlRole` are NOT stored here — they come from the router (path param
// + search) and are merged in on return, so route changes are always reflected.
type LiveState = Omit<
	PlotWebDashboardState,
	"selectedSessionId" | "controlRole"
>;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const workflowNameFor = (
	roster: readonly PlotSessionSummary[],
	sessionId: string,
) =>
	roster.find((session) => session.id === sessionId)?.workflowName ?? sessionId;

const runtimeFor = (
	roster: readonly PlotSessionSummary[],
	sessionId: string,
) => {
	const session = roster.find((candidate) => candidate.id === sessionId);
	return {
		cwd: session?.cwd ?? "",
		cwdName: session?.cwdName ?? "",
		workflowPath: session?.workflowPath,
		maxConcurrentRuns: session?.agents.max,
		skills: [],
		skillPaths: [],
	};
};

const projectionBase = (input: {
	readonly sessionId: string;
	readonly roster: readonly PlotSessionSummary[];
}) =>
	emptyProjection(
		input.sessionId,
		workflowNameFor(input.roster, input.sessionId),
		runtimeFor(input.roster, input.sessionId),
	);

const projectionFromSnapshot = (input: {
	readonly sessionId: string;
	readonly roster: readonly PlotSessionSummary[];
	readonly snapshot: unknown;
	readonly asOfSequence?: number | undefined;
}) =>
	applySnapshot(projectionBase(input), {
		snapshot: normalizeWireSnapshot(input.snapshot),
		...(input.asOfSequence === undefined
			? {}
			: { asOfSequence: input.asOfSequence }),
	});

const normalizeWireSnapshot = (snapshot: unknown) => {
	if (!isRecord(snapshot)) return snapshot;
	const running = normalizeMapLike(snapshot["running"]);
	const retries = normalizeMapLike(snapshot["retries"]);
	return {
		...snapshot,
		...(running === undefined ? {} : { running }),
		...(retries === undefined ? {} : { retries }),
	};
};

const normalizeMapLike = (value: unknown): Map<string, unknown> | undefined => {
	if (value instanceof Map) return value;
	if (Array.isArray(value)) return new Map(value as [string, unknown][]);
	if (isRecord(value)) return new Map(Object.entries(value));
	return undefined;
};

const snapshotFromResponse = (record: PlotServerRecord) => {
	if (record.kind !== "response" || !record.ok || !isRecord(record.data))
		return undefined;
	return {
		snapshot: record.data["snapshot"],
		asOfSequence:
			typeof record.asOfSequence === "number"
				? record.asOfSequence
				: typeof record.data["asOfSequence"] === "number"
					? record.data["asOfSequence"]
					: undefined,
	};
};

const sessionsFromResponse = (record: PlotServerRecord) => {
	if (record.kind !== "response" || !record.ok || !isRecord(record.data))
		return undefined;
	return Array.isArray(record.data["sessions"])
		? (record.data["sessions"] as readonly PlotSessionSummary[])
		: undefined;
};

const refreshRoster = async (
	client: BrowserPlotControlClient,
	setState: (update: (state: LiveState) => LiveState) => void,
) => {
	const roster = await client.listSessions();
	setState((state) => ({ ...state, roster, connection: "online" }));
	return roster;
};

const refreshProjection = async (
	client: BrowserPlotControlClient,
	setState: (update: (state: LiveState) => LiveState) => void,
	sessionId: string,
) => {
	const response = await client.request("get_snapshot", { sessionId });
	const snapshot = snapshotFromResponse(response);
	if (snapshot === undefined) return;
	setState((state) => {
		const roster = state.roster;
		const base = state.projection ?? projectionBase({ sessionId, roster });
		return {
			...state,
			projection: applySnapshot(base, {
				snapshot: normalizeWireSnapshot(snapshot.snapshot),
				...(snapshot.asOfSequence === undefined
					? {}
					: { asOfSequence: snapshot.asOfSequence }),
			}),
			snapshotUnavailable: false,
		};
	});
};

const applyRosterEvent = (
	state: LiveState,
	record: Extract<PlotServerRecord, { kind: "roster_event" }>,
): LiveState => {
	const roster =
		record.event === "session_closed"
			? state.roster.map((session) =>
					session.id === record.session.id ? record.session : session,
				)
			: [
					record.session,
					...state.roster.filter((session) => session.id !== record.session.id),
				];
	return { ...state, roster };
};

/**
 * Live dashboard state for the active route. `sessionId` is the path param
 * (undefined on the fleet route) and `role` the `?role=` search modifier; the
 * hook (re)connects + attaches whenever either changes.
 */
export const usePlotWebDashboardState = ({
	sessionId,
	role,
}: {
	sessionId?: string | undefined;
	role: ControlRole;
}): PlotWebDashboardState => {
	const [state, setState] = useState<LiveState>({
		connection: "connecting",
		roster: [],
	});

	useEffect(() => {
		let cancelled = false;
		let client: BrowserPlotControlClient | undefined;
		let scheduledRefresh: number | undefined;
		const scheduleSnapshotRefresh = () => {
			if (sessionId === undefined || client === undefined) return;
			if (scheduledRefresh !== undefined) return;
			scheduledRefresh = window.setTimeout(() => {
				scheduledRefresh = undefined;
				if (cancelled || client === undefined || sessionId === undefined)
					return;
				void refreshProjection(client, setState, sessionId).catch(
					() => undefined,
				);
			}, 250);
		};
		// Switching sessions clears the prior projection while the new snapshot loads.
		setState((current) => ({
			...current,
			projection: undefined,
			snapshotUnavailable: undefined,
		}));
		const connect = async () => {
			const handoff = readBrowserControlHandoff(window.location);
			if (handoff === undefined) {
				setState((current) => ({
					...current,
					connection: "handoff-missing",
					lastError: "Local Plot Server handoff was not provided.",
				}));
				return;
			}
			while (!cancelled) {
				try {
					setState((current) => ({ ...current, connection: "connecting" }));
					client = await connectBrowserPlotControl(handoff);
					if (cancelled) return;
					setState((current) => ({
						...current,
						sendCommand: async (command, params) => {
							try {
								await client!.request(command, params);
								setState((latest) => ({
									...latest,
									mutationError: undefined,
								}));
							} catch (error) {
								setState((latest) => ({
									...latest,
									mutationError: errorMessage(error),
								}));
								throw error;
							}
						},
					}));
					client.onRecord((record) => {
						const snapshot = snapshotFromResponse(record);
						if (snapshot !== undefined && sessionId !== undefined) {
							setState((current) => {
								const base =
									current.projection ??
									projectionBase({ sessionId, roster: current.roster });
								return {
									...current,
									projection: applySnapshot(base, {
										snapshot: normalizeWireSnapshot(snapshot.snapshot),
										...(snapshot.asOfSequence === undefined
											? {}
											: { asOfSequence: snapshot.asOfSequence }),
									}),
									snapshotUnavailable: false,
								};
							});
						}
						if (record.kind === "roster_event") {
							setState((current) => applyRosterEvent(current, record));
							void refreshRoster(client!, setState).catch(() => undefined);
							return;
						}
						const sessions = sessionsFromResponse(record);
						if (sessions !== undefined)
							setState((current) => ({ ...current, roster: sessions }));
						if (record.kind !== "session_event") return;
						if (record.sessionId !== sessionId) return;
						setState((current) => {
							const projection =
								current.projection ??
								emptyProjection(
									record.sessionId,
									workflowNameFor(current.roster, record.sessionId),
									runtimeFor(current.roster, record.sessionId),
								);
							return {
								...current,
								projection: reduceSessionHistoryEvent(
									projection,
									record.event as SessionHistoryEvent,
								),
							};
						});
						scheduleSnapshotRefresh();
					});
					const roster = await refreshRoster(client, setState);
					if (sessionId !== undefined) {
						const attached = await client.attachSession({
							sessionId,
							role,
						});
						setState((current) => {
							const snapshotProjection = projectionFromSnapshot({
								sessionId,
								roster: current.roster.length === 0 ? roster : current.roster,
								snapshot: attached.snapshot,
								asOfSequence: attached.lastSequence,
							});
							return {
								...current,
								projection:
									current.projection !== undefined &&
									current.projection.frontier > attached.lastSequence
										? current.projection
										: snapshotProjection,
								snapshotUnavailable: false,
							};
						});
					}
					return;
				} catch (error) {
					client?.close();
					client = undefined;
					setState((current) => ({
						...current,
						connection:
							current.projection || current.roster.length > 0
								? "offline"
								: "handoff-missing",
						lastError: errorMessage(error),
					}));
					await new Promise((resolve) => window.setTimeout(resolve, 1500));
				}
			}
		};
		void connect();
		return () => {
			cancelled = true;
			if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
			client?.close();
		};
	}, [role, sessionId]);

	return { ...state, selectedSessionId: sessionId, controlRole: role };
};
