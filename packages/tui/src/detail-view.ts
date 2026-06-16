import { workLabel } from "@plot/control/projection";
import {
	formatAgo,
	formatCost,
	formatDuration,
	formatTokens,
	type WorkRowModel,
} from "@plot/control/dashboard-model";
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

const tokenLine = (selected: WorkRowModel): string => {
	const tokens = selected.attempt?.tokens;
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
	selected: WorkRowModel,
	nowMs = Date.now(),
): readonly DashboardLine[] => {
	const { work, attempt } = selected;
	const age =
		attempt?.startedAtMs === undefined
			? "n/a"
			: formatDuration(nowMs - attempt.startedAtMs);
	return [
		...(work.subtitle === undefined ? [] : [item(work.subtitle, style.muted)]),
		...(work.url === undefined ? [] : [item(work.url, style.accent)]),
		blankDetail(),
		section("Status"),
		item(`${style.stage[work.status](`${work.status} for ${age}`)}`),
		...(work.blockedReason === undefined
			? []
			: [item(work.blockedReason, style.warn)]),
		...(attempt === undefined
			? []
			: [
					item(
						style.muted(
							`turn ${attempt.turnCount} · ${attempt.eventCount} events · verification ${attempt.check} · attempt ${attempt.stage}`,
						),
					),
				]),
		item(tokenLine(selected), style.muted),
		blankDetail(),
		section("Now"),
		item(
			`${quoteActivity(selected.activity)}${
				attempt?.lastEventAtMs === undefined
					? ""
					: style.muted(` · ${formatAgo(nowMs - attempt.lastEventAtMs)}`)
			}`,
		),
		...(attempt === undefined
			? []
			: [
					blankDetail(),
					section("Recent"),
					...(attempt.timeline.length === 0
						? [emptyItem(style.muted)]
						: attempt.timeline.map((entry) =>
								item(
									`${style.dim(formatAgo(nowMs - entry.atMs).padEnd(12))} ${entry.text}`,
								),
							)),
					blankDetail(),
					section("Commands"),
					...(attempt.commands.length === 0
						? [emptyItem(style.muted)]
						: attempt.commands.map((command) => item(command, style.muted))),
					...(attempt.observations.length === 0
						? []
						: [
								blankDetail(),
								section("Notes"),
								...attempt.observations.map((observation) => item(observation)),
							]),
				]),
	];
};

export const detailViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly selected: WorkRowModel | undefined;
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
		asLine(
			`${style.border("╭─ ")}${style.brand(workLabel(input.selected.work))}`,
		),
		...body.slice(input.scrollOffset, input.scrollOffset + input.viewportRows),
		footer(
			`j/k scroll   ${input.selected.work.url === undefined ? "" : "o open   "}esc back   q quit`,
			style.muted,
		),
	];
};
