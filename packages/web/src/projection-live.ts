import {
	reduceRecord,
	type DashboardProjection,
	type ProjectableEventRecord,
} from "@plot/session/projection";
import type { PlotEventRecord, WebDashboardProjection } from "./api.js";

const inflateProjection = (
	projection: WebDashboardProjection,
): DashboardProjection => ({
	...projection,
	work: new Map(Object.entries(projection.work)),
	attempts: new Map(Object.entries(projection.attempts)),
});

const serializeProjection = (
	projection: DashboardProjection,
): WebDashboardProjection => ({
	...projection,
	work: Object.fromEntries(projection.work),
	attempts: Object.fromEntries(projection.attempts),
});

export const applyProjectionEvent = (
	projection: WebDashboardProjection,
	record: PlotEventRecord,
): WebDashboardProjection => {
	if (record.event.sequence <= projection.frontier) return projection;
	return serializeProjection(
		reduceRecord(
			inflateProjection(projection),
			record as ProjectableEventRecord,
		),
	);
};
