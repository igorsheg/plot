import { basename } from "node:path";
import {
	emptyProjection,
	reduceProjectableEvent,
	type DashboardProjection,
} from "@plot/projection";
import type { SessionSummary } from "@plot/session-manager/session";
import { readSessionEvents } from "@plot/session/history";

export interface SessionStatus {
	readonly session: SessionSummary;
	readonly needsYou: number;
	readonly active: number;
	readonly waiting: number;
	readonly pending: number;
	readonly lastTickAtMs?: number | undefined;
}

const initialProjection = (session: SessionSummary): DashboardProjection =>
	emptyProjection(session.id, session.workflowName, {
		cwd: session.projectPath,
		cwdName: basename(session.projectPath),
		workflowPath: session.workflowPath,
		skills: [],
		skillPaths: [],
	});

export const loadSessionStatus = async (
	session: SessionSummary,
): Promise<SessionStatus> => {
	let projection = initialProjection(session);
	for await (const event of readSessionEvents(session.historyPath))
		projection = reduceProjectableEvent(projection, event);

	const needsYou =
		[...projection.sources.values()].filter(
			(source) => source.readiness === "action-required",
		).length +
		[...projection.work.values()].filter((work) => work.status === "blocked")
			.length;
	const status: SessionStatus = {
		session,
		needsYou,
		active: projection.attempts.size,
		waiting: [...projection.work.values()].filter(
			(work) => work.status === "waiting",
		).length,
		pending: [...projection.work.values()].filter(
			(work) => work.status === "pending",
		).length,
	};
	if (projection.pulse !== undefined)
		return { ...status, lastTickAtMs: projection.pulse.atMs };
	return status;
};
