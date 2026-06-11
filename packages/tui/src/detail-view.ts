import { workLabel, type RunningWorkProjection } from "./projection.js";
import { formatAgo, formatDuration, formatTokens } from "./dashboard-model.js";
import {
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

const tokenLine = (selected: RunningWorkProjection): string => {
	const tokens = selected.tokens;
	if (tokens === undefined) return "tokens none yet";
	const parts = [
		`tokens ${formatTokens(tokens.total ?? 0)} total`,
		...(tokens.input === undefined ? [] : [`${formatTokens(tokens.input)} in`]),
		...(tokens.output === undefined
			? []
			: [`${formatTokens(tokens.output)} out`]),
	];
	return parts.join(" · ");
};

export const detailBodyLines = (
	selected: RunningWorkProjection,
	nowMs = Date.now(),
): readonly DashboardLine[] => {
	const age =
		selected.startedAtMs === undefined
			? "n/a"
			: formatDuration(nowMs - selected.startedAtMs);
	return [
		...(selected.subtitle === undefined
			? []
			: [item(selected.subtitle, style.muted)]),
		...(selected.url === undefined ? [] : [item(selected.url, style.accent)]),
		item(
			`${style.stage[selected.stage](selected.stage)}${style.muted(
				` · age ${age} · turns ${selected.turnCount} · events ${selected.eventCount} · check ${selected.check}`,
			)}`,
		),
		item(tokenLine(selected), style.muted),
		section("NOW"),
		item(
			`${selected.activity}${
				selected.lastEventAtMs === undefined
					? ""
					: ` · ${formatAgo(nowMs - selected.lastEventAtMs)}`
			}`,
		),
		section("TIMELINE"),
		...(selected.timeline.length === 0
			? [emptyItem(style.muted)]
			: selected.timeline.map((entry) =>
					item(
						`${style.dim(formatAgo(nowMs - entry.atMs).padEnd(12))} ${entry.text}`,
					),
				)),
		section("OBSERVATIONS"),
		...(selected.observations.length === 0
			? [emptyItem(style.muted)]
			: selected.observations.map((observation) => item(observation))),
		section("COMMANDS"),
		...(selected.commands.length === 0
			? [emptyItem(style.muted)]
			: selected.commands.map((command) => item(command, style.muted))),
	];
};

export const detailViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly selected: RunningWorkProjection | undefined;
	readonly scrollOffset: number;
	readonly viewportRows: number;
}): readonly DashboardLine[] => {
	if (input.selected === undefined) {
		return [
			...input.header,
			section("DETAIL"),
			emptyItem(style.muted),
			footer("esc back", style.muted),
		];
	}
	const body = detailBodyLines(input.selected);
	return [
		...input.header,
		section(`WORK ${workLabel(input.selected)}`),
		...body.slice(input.scrollOffset, input.scrollOffset + input.viewportRows),
		footer(
			`j/k scroll${input.selected.url === undefined ? "" : " · o open"} · esc back · q quit`,
			style.muted,
		),
	];
};
