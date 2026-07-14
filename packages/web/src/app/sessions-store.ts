import { atom, computed } from "nanostores";
import type { SessionSummary } from "@plot/session-manager/session";
import { createFetcherStore } from "../data/query.js";
import { isActiveSession } from "../data/session.js";
import { sessionsUrl } from "../data/routes.js";

export const displayName = (session: SessionSummary): string =>
	session.workflowName;

export const activeSessions = (
	sessions: readonly SessionSummary[],
): readonly SessionSummary[] => sessions.filter(isActiveSession);

export const selectedSessionFrom = (
	sessions: readonly SessionSummary[],
	active: readonly SessionSummary[],
	selectedId: string | undefined,
): SessionSummary | undefined =>
	sessions.find((session) => session.id === selectedId) ?? active[0];

const updatedMs = (session: SessionSummary): number => {
	const ms = Date.parse(session.updatedAt);
	return Number.isNaN(ms) ? 0 : ms;
};

export const pastSessions = (
	sessions: readonly SessionSummary[],
): readonly SessionSummary[] =>
	sessions
		.filter(
			(session) => session.state === "stopped" || session.state === "error",
		)
		.toSorted((a, b) => updatedMs(b) - updatedMs(a));

/** One board tab per active Workflow, plus a selected historical-only Workflow. */
export const workflowTabSessions = (
	active: readonly SessionSummary[],
	selected: SessionSummary,
): readonly SessionSummary[] =>
	active.some((session) => session.workflowKey === selected.workflowKey)
		? active
		: [...active, selected];

export const $selectedSessionId = atom<string | undefined>(undefined);

export const $sessionsQuery = createFetcherStore<readonly SessionSummary[]>(
	sessionsUrl,
	{
		revalidateInterval: 10_000,
		revalidateOnFocus: true,
	},
);

export const $sessions = computed($sessionsQuery, (query) => query.data ?? []);
export const $activeSessions = computed($sessions, activeSessions);
export const $pastSessions = computed($sessions, pastSessions);
export const $selectedSession = computed(
	[$sessions, $activeSessions, $selectedSessionId],
	selectedSessionFrom,
);

export const $workflowTabSessions = computed(
	[$activeSessions, $selectedSession],
	(active, selected) =>
		selected === undefined ? [] : workflowTabSessions(active, selected),
);

export const selectSession = (id: string): void => {
	$selectedSessionId.set(id);
};

export const selectWorkflow = (workflowKey: string): void => {
	const session = $workflowTabSessions
		.get()
		.find((item) => item.workflowKey === workflowKey);
	if (session !== undefined) selectSession(session.id);
};
