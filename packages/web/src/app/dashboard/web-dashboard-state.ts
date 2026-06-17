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
import { createProjectionCoalescer } from "./projection-coalescer";
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
	const work = normalizeMapLike(snapshot["work"]);
	const running = normalizeMapLike(snapshot["running"]);
	const retries = normalizeMapLike(snapshot["retries"]);
	return {
		...snapshot,
		...(work === undefined ? {} : { work }),
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

const nextRoster = (
	roster: readonly PlotSessionSummary[],
	record: Extract<PlotServerRecord, { kind: "roster_event" }>,
): readonly PlotSessionSummary[] =>
	record.event === "session_closed"
		? roster.map((session) =>
				session.id === record.session.id ? record.session : session,
			)
		: [
				record.session,
				...roster.filter((session) => session.id !== record.session.id),
			];

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
		// `live` is the authoritative reduced projection; reduction runs on every
		// event, but the coalescer bounds how often it reaches React state.
		let live: DashboardProjection | undefined;
		let roster: readonly PlotSessionSummary[] = [];
		const coalescer = createProjectionCoalescer({
			intervalMs: 100,
			publish: (projection) => {
				if (cancelled) return;
				setState((current) => ({
					...current,
					projection,
					snapshotUnavailable: false,
				}));
			},
		});

		const setRoster = (next: readonly PlotSessionSummary[]) => {
			roster = next;
			setState((current) => ({
				...current,
				roster: next,
				connection: "online",
			}));
		};

		const applyWireSnapshot = (snapshot: unknown, asOfSequence?: number) => {
			if (sessionId === undefined) return;
			live = applySnapshot(live ?? projectionBase({ sessionId, roster }), {
				snapshot: normalizeWireSnapshot(snapshot),
				...(asOfSequence === undefined ? {} : { asOfSequence }),
			});
			coalescer.replace(live);
		};

		const scheduleSnapshotRefresh = () => {
			if (sessionId === undefined || client === undefined) return;
			if (scheduledRefresh !== undefined) return;
			scheduledRefresh = window.setTimeout(() => {
				scheduledRefresh = undefined;
				if (cancelled || client === undefined || sessionId === undefined)
					return;
				void client
					.request("get_snapshot", { sessionId })
					.then((response) => {
						const snapshot = snapshotFromResponse(response);
						return snapshot === undefined
							? undefined
							: applyWireSnapshot(snapshot.snapshot, snapshot.asOfSequence);
					})
					.catch(() => undefined);
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
						if (snapshot !== undefined && sessionId !== undefined)
							applyWireSnapshot(snapshot.snapshot, snapshot.asOfSequence);
						if (record.kind === "roster_event") {
							setRoster(nextRoster(roster, record));
							void client!
								.listSessions()
								.then(setRoster)
								.catch(() => undefined);
							return;
						}
						const sessions = sessionsFromResponse(record);
						if (sessions !== undefined) setRoster(sessions);
						if (record.kind !== "session_event") return;
						if (record.sessionId !== sessionId) return;
						const base =
							live ??
							emptyProjection(
								record.sessionId,
								workflowNameFor(roster, record.sessionId),
								runtimeFor(roster, record.sessionId),
							);
						live = reduceSessionHistoryEvent(
							base,
							record.event as SessionHistoryEvent,
						);
						coalescer.push(live);
						scheduleSnapshotRefresh();
					});
					setRoster(await client.listSessions());
					if (sessionId !== undefined) {
						const attached = await client.attachSession({
							sessionId,
							role,
							// Rebuild derived rows (tokens, recent runs) from the same
							// Session History stream the TUI uses.
							afterSequence: 0,
						});
						const snapshotProjection = projectionFromSnapshot({
							sessionId,
							roster,
							snapshot: attached.snapshot,
							asOfSequence: attached.lastSequence,
						});
						live =
							live !== undefined && live.frontier > attached.lastSequence
								? live
								: snapshotProjection;
						coalescer.replace(live);
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
			coalescer.dispose();
			if (scheduledRefresh !== undefined) window.clearTimeout(scheduledRefresh);
			client?.close();
		};
	}, [role, sessionId]);

	return { ...state, selectedSessionId: sessionId, controlRole: role };
};
