import type { DashboardProjection } from "./projection.js";
import {
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

export const configViewLines = (
	projection: DashboardProjection,
	header: readonly DashboardLine[],
): readonly DashboardLine[] => {
	const r = projection.runtime;
	return [
		...header,
		section("RUNTIME"),
		item(`workflow: ${r.workflowPath ?? projection.workflowName}`),
		item(`cwd: ${r.cwd}`),
		item(`provider: ${r.provider ?? "unknown"}`),
		item(`model: ${r.model ?? "unknown"}`),
		item(`thinking: ${r.thinking ?? "default"}`),
		item(
			`tick interval: ${r.tickIntervalMs === undefined ? "default" : `${r.tickIntervalMs}ms`}`,
		),
		item(
			`max concurrency: ${r.maxConcurrentRuns === undefined ? "default" : String(r.maxConcurrentRuns)}`,
		),
		item(
			`max run duration: ${r.maxRunDurationMs === undefined ? "default" : `${r.maxRunDurationMs}ms`}`,
		),
		section("SKILLS"),
		...(r.skillPaths.length === 0
			? [emptyItem(style.muted)]
			: r.skillPaths.map((skill) => item(skill))),
		footer(
			"j/k scroll · esc back · c close · t tick · g refresh · q quit",
			style.muted,
		),
	];
};
