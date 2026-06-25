import type { PlotEventRecord, WebDashboardProjection } from "./api.js";

export const applyProjectionEvent = (
	projection: WebDashboardProjection,
	record: PlotEventRecord,
): WebDashboardProjection => {
	if (record.event.sequence <= projection.frontier) return projection;
	// ponytail: detail windows show live movement now; use the shared full projection reducer when rows need exact live mutation.
	return {
		...projection,
		frontier: record.event.sequence,
		activity: [
			{
				atMs: Date.parse(record.event.timestamp) || Date.now(),
				tone: "info",
				text: record.event.type,
			},
			...projection.activity,
		].slice(0, 24),
	};
};
