import { isRecord } from "@plot/common/primitives";
import { formatDuration, type WorkRowModel } from "./dashboard-model.js";
import {
	asLine,
	blank,
	cell,
	emptyItem,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { quoteActivity } from "./shimmer.js";
import { style } from "./style.js";

const trailWindowRows = 9;

const summaryLine = (selected: WorkRowModel): DashboardLine =>
	item(
		`  ${style.stage[selected.status](selected.status)}${
			selected.attempt === undefined
				? ""
				: style.muted(`      ${selected.meta}`)
		}`,
	);

const trailAge = (atMs: number, nowMs: number) =>
	formatDuration(Math.max(0, nowMs - atMs));

const workTrailLines = (
	selected: WorkRowModel,
	nowMs: number,
): readonly DashboardLine[] => {
	const attempt = selected.attempt;
	if (attempt === undefined) return [item("  no activity yet", style.muted)];

	const live =
		attempt.streaming || attempt.timeline.length === 0
			? [{ age: "now", text: quoteActivity(selected.activity) }]
			: [];
	// Chronological tail: newest entries sit at the bottom, next to the live
	// row. (toReversed().slice(-n) kept the oldest entries, so the trail froze
	// once it outgrew the window.)
	const history = attempt.timeline
		.slice(-(trailWindowRows - live.length))
		.map((entry) => ({ age: trailAge(entry.atMs, nowMs), text: entry.text }));
	return [...history, ...live].map((entry) =>
		item(`  ${cell(entry.age, 8, style.dim)} ${entry.text}`),
	);
};

/** Labels of the Source-declared Operator Actions on a blocked Work Item. */
const operatorActionLabels = (selected: WorkRowModel): readonly string[] =>
	(selected.work.operatorActions ?? []).flatMap((action) => {
		if (!isRecord(action)) return [];
		const label = action["label"] ?? action["id"];
		return typeof label === "string" ? [label] : [];
	});

const attentionLines = (selected: WorkRowModel): readonly DashboardLine[] => {
	const blocked = selected.status === "blocked";
	const actions = blocked ? operatorActionLabels(selected) : [];
	const lines = [
		...(blocked && selected.work.blockedReason !== undefined
			? [selected.work.blockedReason]
			: []),
		...(actions.length === 0 ? [] : [`actions: ${actions.join(" · ")}`]),
		...(selected.stale ? [`stale · last event ${selected.lastEventAgo}`] : []),
	];
	return lines.length === 0
		? []
		: [
				section("Attention", style.warn),
				blank(),
				...lines.map((line) => item(`  ${line}`, style.warn)),
				blank(),
			];
};

export const detailBodyLines = (
	selected: WorkRowModel,
	nowMs = Date.now(),
): readonly DashboardLine[] => [
	blank(),
	summaryLine(selected),
	blank(),
	section("Work trail"),
	blank(),
	...workTrailLines(selected, nowMs),
	blank(),
	...attentionLines(selected),
];

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
		asLine(`${style.border("╭─ ")}${style.brand(input.selected.label)}`),
		...body.slice(input.scrollOffset, input.scrollOffset + input.viewportRows),
		footer(
			`j/k scroll · ${input.selected.work.url === undefined ? "" : "o open · "}esc back · q quit`,
			style.muted,
		),
	];
};
