import type { DashboardProjection } from "./projection.js";
import {
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

export const debugViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly projection: DashboardProjection;
	readonly scrollOffset: number;
	readonly viewportRows: number;
}): readonly DashboardLine[] => [
	...input.header,
	section("DEBUG EVENTS"),
	...(input.projection.debugEvents.length === 0
		? [emptyItem(style.muted)]
		: input.projection.debugEvents
				.slice(input.scrollOffset, input.scrollOffset + input.viewportRows)
				.map((entry) => item(entry))),
	footer("j/k scroll · esc back · d close · q quit", style.muted),
];
