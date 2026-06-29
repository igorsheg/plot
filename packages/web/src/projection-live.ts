import {
	hydrateDashboardProjection,
	reduceRecord,
	serializeDashboardProjection,
	type ProjectableEventRecord,
} from "@plot/session/projection";
import type { PlotEventRecord, WebDashboardProjection } from "./api.js";

export const applyProjectionEvent = (
	projection: WebDashboardProjection,
	record: PlotEventRecord,
): WebDashboardProjection => {
	if (record.event.sequence <= projection.frontier) return projection;
	return serializeDashboardProjection(
		reduceRecord(
			hydrateDashboardProjection(projection),
			record as ProjectableEventRecord,
		),
	);
};
