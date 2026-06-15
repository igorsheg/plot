import type { DashboardProjection } from "@plot/control/projection";
import type {
	PlotSessionState,
	PlotSessionSummary,
} from "@plot/control/session-summary";

export type DashboardSurface = "fleet" | "session";

const stateRank: Record<PlotSessionState, number> = {
	starting: 3,
	watching: 5,
	reconciling: 2,
	acting: 2,
	idle: 5,
	paused: 4,
	stopping: 6,
	stopped: 6,
	error: 1,
};

const activeRank = (session: PlotSessionSummary) =>
	session.state === "acting" ||
	session.state === "reconciling" ||
	session.agents.active > 0
		? 2
		: stateRank[session.state];

const lastActivityMs = (session: PlotSessionSummary) => {
	if (session.lastActivityAt === null) return 0;
	const ms = Date.parse(session.lastActivityAt);
	return Number.isFinite(ms) ? ms : 0;
};

export const sortPlotSessions = (
	sessions: readonly PlotSessionSummary[],
): readonly PlotSessionSummary[] =>
	[...sessions].toSorted(
		(a, b) =>
			Number(b.needsYouCount > 0) - Number(a.needsYouCount > 0) ||
			b.needsYouCount - a.needsYouCount ||
			activeRank(a) - activeRank(b) ||
			lastActivityMs(b) - lastActivityMs(a) ||
			a.workflowName.localeCompare(b.workflowName),
	);

export const visibleFleetSessions = (
	sessions: readonly PlotSessionSummary[],
	showStopped: boolean,
): readonly PlotSessionSummary[] => {
	const sorted = sortPlotSessions(sessions);
	return showStopped
		? sorted
		: sorted.filter((session) => session.state !== "stopped");
};

export const stoppedSessionCount = (sessions: readonly PlotSessionSummary[]) =>
	sessions.filter((session) => session.state === "stopped").length;

export const chooseInitialSession = (input: {
	readonly roster: readonly PlotSessionSummary[];
	readonly requestedSessionId?: string | undefined;
	readonly explicitFleet: boolean;
	readonly currentSessionId?: string | undefined;
}): string | undefined => {
	if (
		input.currentSessionId !== undefined &&
		input.roster.some((session) => session.id === input.currentSessionId)
	)
		return input.currentSessionId;
	if (
		input.requestedSessionId !== undefined &&
		input.roster.some((session) => session.id === input.requestedSessionId)
	)
		return input.requestedSessionId;
	if (!input.explicitFleet && input.roster.length === 1)
		return input.roster[0]?.id;
	return undefined;
};

export const resolveSurface = (input: {
	readonly roster: readonly PlotSessionSummary[];
	readonly selectedSessionId?: string | undefined;
	readonly explicitFleet: boolean;
}): DashboardSurface => {
	if (input.explicitFleet) return "fleet";
	if (input.selectedSessionId !== undefined) return "session";
	if (input.roster.length === 1) return "session";
	return "fleet";
};

export const projectionReadyDoneCounts = (projection: DashboardProjection) => ({
	ready: projection.scheduledWakes.length,
	done: projection.completed.length,
});
