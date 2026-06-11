import { workLabel, type RunningWorkProjection } from "./projection.js";
import {
	formatAgo,
	formatCost,
	formatDuration,
	formatTokens,
} from "./dashboard-model.js";
import {
	asLine,
	blank,
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { quoteActivity } from "./shimmer.js";
import { style } from "./style.js";

const blankDetail = () => blank();

const tokenLine = (selected: RunningWorkProjection): string => {
	const tokens = selected.tokens;
	if (tokens === undefined) return "tokens none yet";
	const parts = [
		`${formatTokens(tokens.total ?? 0)} tokens`,
		...(tokens.input === undefined ? [] : [`${formatTokens(tokens.input)} in`]),
		...(tokens.output === undefined
			? []
			: [`${formatTokens(tokens.output)} out`]),
		...(tokens.cost === undefined ? [] : [formatCost(tokens.cost)]),
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
		blankDetail(),
		section("Status"),
		item(`${style.stage[selected.stage](`${selected.stage} for ${age}`)}`),
		item(
			style.muted(
				`turn ${selected.turnCount} · ${selected.eventCount} events · verification ${selected.check}`,
			),
		),
		item(tokenLine(selected), style.muted),
		blankDetail(),
		section("Now"),
		item(
			`${quoteActivity(selected.activity)}${
				selected.lastEventAtMs === undefined
					? ""
					: style.muted(` · ${formatAgo(nowMs - selected.lastEventAtMs)}`)
			}`,
		),
		blankDetail(),
		section("Recent"),
		...(selected.timeline.length === 0
			? [emptyItem(style.muted)]
			: selected.timeline.map((entry) =>
					item(
						`${style.dim(formatAgo(nowMs - entry.atMs).padEnd(12))} ${entry.text}`,
					),
				)),
		blankDetail(),
		section("Commands"),
		...(selected.commands.length === 0
			? [emptyItem(style.muted)]
			: selected.commands.map((command) => item(command, style.muted))),
		...(selected.observations.length === 0
			? []
			: [
					blankDetail(),
					section("Notes"),
					...selected.observations.map((observation) => item(observation)),
				]),
	];
};

export const detailViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly selected: RunningWorkProjection | undefined;
	readonly scrollOffset: number;
	readonly viewportRows: number;
}): readonly DashboardLine[] => {
	void input.header;
	if (input.selected === undefined) {
		return [
			asLine(`${style.border("╭─ ")}${style.brand("Detail")}`),
			emptyItem(style.muted),
			footer("esc back", style.muted),
		];
	}
	const body = detailBodyLines(input.selected);
	return [
		asLine(`${style.border("╭─ ")}${style.brand(workLabel(input.selected))}`),
		...body.slice(input.scrollOffset, input.scrollOffset + input.viewportRows),
		footer(
			`j/k scroll   ${input.selected.url === undefined ? "" : "o open   "}esc back   q quit`,
			style.muted,
		),
	];
};
