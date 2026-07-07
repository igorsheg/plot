import {
	hydrateDashboardProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type ProjectableEvent,
	type SerializedDashboardProjection,
} from "@plot/projection";
import type { RunRecord } from "@plot/registry/record";

export const projectionMatchesRun = (
	projection: SerializedDashboardProjection,
	run: RunRecord,
): boolean => projection.sessionId === (run.sessionId ?? run.id);

export const reduceSerializedProjection = (
	projection: SerializedDashboardProjection,
	event: ProjectableEvent,
): SerializedDashboardProjection => {
	if (event.sequence <= projection.frontier) return projection;
	return serializeDashboardProjection(
		reduceProjectableEvent(hydrateDashboardProjection(projection), event),
	);
};
