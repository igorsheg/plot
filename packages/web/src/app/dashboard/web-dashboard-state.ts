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
import { useEffect, useMemo, useState } from "react";
import {
	chooseInitialSession,
	resolveSurface,
	type DashboardSurface,
} from "./fleet-model";
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

export interface PlotWebDashboardState {
	readonly connection: ConnectionState;
	readonly roster: readonly PlotSessionSummary[];
	readonly selectedSessionId?: string | undefined;
	readonly projection?: DashboardProjection | undefined;
	readonly explicitFleet: boolean;
	readonly controlRole: "observer" | "controller";
	readonly sendCommand?: (
		command: PlotCommand,
		params?: unknown,
	) => Promise<void>;
	readonly lastError?: string | undefined;
	readonly mutationError?: string | undefined;
	readonly snapshotUnavailable?: boolean | undefined;
}

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

const projectionFromSnapshot = (input: {
	readonly sessionId: string;
	readonly roster: readonly PlotSessionSummary[];
	readonly snapshot: unknown;
}) =>
	applySnapshot(
		emptyProjection(
			input.sessionId,
			workflowNameFor(input.roster, input.sessionId),
			runtimeFor(input.roster, input.sessionId),
		),
		{ snapshot: normalizeWireSnapshot(input.snapshot) },
	);

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

const sessionsFromResponse = (record: PlotServerRecord) => {
	if (record.kind !== "response" || !record.ok || !isRecord(record.data))
		return undefined;
	return Array.isArray(record.data["sessions"])
		? (record.data["sessions"] as readonly PlotSessionSummary[])
		: undefined;
};

const refreshRoster = async (
	client: BrowserPlotControlClient,
	setState: (
		update: (state: PlotWebDashboardState) => PlotWebDashboardState,
	) => void,
) => {
	const roster = await client.listSessions();
	setState((state) => {
		const selectedSessionId = chooseInitialSession({
			roster,
			currentSessionId: state.selectedSessionId,
			explicitFleet: state.explicitFleet,
		});
		return { ...state, roster, selectedSessionId, connection: "online" };
	});
	return roster;
};

const applyRosterEvent = (
	state: PlotWebDashboardState,
	record: Extract<PlotServerRecord, { kind: "roster_event" }>,
): PlotWebDashboardState => {
	const roster =
		record.event === "session_closed"
			? state.roster.map((session) =>
					session.id === record.session.id ? record.session : session,
				)
			: [
					record.session,
					...state.roster.filter((session) => session.id !== record.session.id),
				];
	const selectedSessionId = chooseInitialSession({
		roster,
		currentSessionId: state.selectedSessionId,
		explicitFleet: state.explicitFleet,
	});
	return { ...state, roster, selectedSessionId };
};

export const usePlotWebDashboardState = (): PlotWebDashboardState => {
	const explicitFleet = useMemo(() => {
		if (typeof window === "undefined") return false;
		const params = new URLSearchParams(window.location.search);
		const hash = new URLSearchParams(window.location.hash.slice(1));
		return params.get("view") === "fleet" || hash.get("view") === "fleet";
	}, []);
	const controlRole = useMemo<"observer" | "controller">(() => {
		if (typeof window === "undefined") return "controller";
		const params = new URLSearchParams(window.location.search);
		const hash = new URLSearchParams(window.location.hash.slice(1));
		return (params.get("role") ?? hash.get("role")) === "observer"
			? "observer"
			: "controller";
	}, []);
	const requestedSessionId = useMemo(() => {
		if (typeof window === "undefined") return undefined;
		const params = new URLSearchParams(window.location.search);
		const hash = new URLSearchParams(window.location.hash.slice(1));
		return params.get("session") ?? hash.get("session") ?? undefined;
	}, []);
	const [state, setState] = useState<PlotWebDashboardState>({
		connection: "connecting",
		roster: [],
		explicitFleet,
		controlRole,
		...(requestedSessionId === undefined
			? {}
			: { selectedSessionId: requestedSessionId }),
	});

	useEffect(() => {
		let cancelled = false;
		let client: BrowserPlotControlClient | undefined;
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
						if (record.kind === "roster_event") {
							setState((current) => applyRosterEvent(current, record));
							void refreshRoster(client!, setState).catch(() => undefined);
							return;
						}
						const sessions = sessionsFromResponse(record);
						if (sessions !== undefined)
							setState((current) => ({ ...current, roster: sessions }));
						if (record.kind !== "session_event") return;
						setState((current) => {
							if (record.sessionId !== current.selectedSessionId)
								return current;
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
					});
					const roster = await refreshRoster(client, setState);
					const selectedSessionId = chooseInitialSession({
						roster,
						requestedSessionId,
						explicitFleet,
					});
					if (selectedSessionId !== undefined) {
						const attached = await client.attachSession({
							sessionId: selectedSessionId,
							role: controlRole,
						});
						setState((current) => {
							const snapshotProjection = projectionFromSnapshot({
								sessionId: selectedSessionId,
								roster: current.roster.length === 0 ? roster : current.roster,
								snapshot: attached.snapshot,
							});
							return {
								...current,
								selectedSessionId,
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
			client?.close();
		};
	}, [controlRole, explicitFleet, requestedSessionId]);
	return state;
};

export const surfaceForState = (
	state: PlotWebDashboardState,
): DashboardSurface =>
	resolveSurface({
		roster: state.roster,
		selectedSessionId: state.selectedSessionId,
		explicitFleet: state.explicitFleet,
	});
