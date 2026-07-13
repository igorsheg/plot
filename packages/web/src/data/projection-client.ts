import {
	hydrateDashboardProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type ProjectableEvent,
	type SerializedDashboardProjection,
} from "@plot/projection";
import type { SessionSummary } from "@plot/session-manager/session";

export const projectionMatchesSession = (
	projection: SerializedDashboardProjection,
	session: SessionSummary,
): boolean => projection.sessionId === session.id;

export const reduceSerializedProjection = (
	projection: SerializedDashboardProjection,
	event: ProjectableEvent,
): SerializedDashboardProjection => {
	if (event.sequence <= projection.frontier) return projection;
	return serializeDashboardProjection(
		reduceProjectableEvent(hydrateDashboardProjection(projection), event),
	);
};
