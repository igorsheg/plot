import type { RunningWorkProjection } from "./projection.js";
import {
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

const tokenText = (selected: RunningWorkProjection) =>
	selected.tokens?.total === undefined ? "0" : String(selected.tokens.total);

export const detailBodyLines = (
	selected: RunningWorkProjection,
): readonly DashboardLine[] => [
	item(`title=${selected.title}`),
	item(
		`status=running stage=${selected.stage} turns=${selected.turnCount} events=${selected.eventCount} tool_updates=${selected.toolUpdateCount} messages=${selected.messageCount} check=${selected.check} tokens=${tokenText(selected)}`,
	),
	section("CURRENT ACTIVITY", style.border),
	item(selected.activity),
	section("LAST MEANINGFUL OUTPUT", style.border),
	item(selected.lastMeaningful),
	section("RECENT ACTIVITY", style.border),
	...(selected.timeline.length === 0
		? [emptyItem(style.muted)]
		: selected.timeline.map((entry) => item(entry))),
	section("OBSERVATIONS", style.border),
	...(selected.observations.length === 0
		? [emptyItem(style.muted)]
		: selected.observations.map((observation) => item(observation))),
	section("COMMANDS", style.border),
	...(selected.commands.length === 0
		? [emptyItem(style.muted)]
		: selected.commands.map((command) => item(command))),
];

export const detailViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly selected: RunningWorkProjection | undefined;
	readonly scrollOffset: number;
	readonly viewportRows: number;
}): readonly DashboardLine[] => {
	if (input.selected === undefined) {
		return [
			...input.header,
			section("DETAIL", style.border),
			emptyItem(style.muted),
			footer("esc fleet", style.muted),
		];
	}
	const body = detailBodyLines(input.selected);
	return [
		...input.header,
		section(
			`WORK ${input.selected.primary ?? input.selected.workKey}`,
			style.border,
		),
		...body.slice(input.scrollOffset, input.scrollOffset + input.viewportRows),
		footer("j/k scroll · esc fleet · d raw events · q shutdown", style.muted),
	];
};
