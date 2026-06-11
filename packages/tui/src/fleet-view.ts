import type {
	DashboardModel,
	WorkRowModel,
	ScheduledRowModel,
} from "./dashboard-model.js";
import {
	blank,
	cell,
	footer,
	item,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { shimmerText, quoteActivity } from "./shimmer.js";
import { style } from "./style.js";

const rowGlyph = (row: WorkRowModel) => {
	if (row.attention) return style.bad("▲");
	if (row.stale) return style.dim("○");
	if (row.stage === "waiting" || row.stage === "starting")
		return style.muted("◌");
	return style.ok("●");
};

const workRowLines = (
	row: WorkRowModel,
	selected: boolean,
	nowMs: number,
): readonly DashboardLine[] => {
	const marker = selected ? style.label("›") : " ";
	const label = row.stale ? style.row.stale(row.label) : style.text(row.label);
	const activeFor = row.age === "n/a" ? row.age : `${row.age} active`;
	const first = item(`${marker} ${rowGlyph(row)} ${label}`);
	const second = item(
		`    ${style.stage[row.stage](row.stage)}${style.muted(` · ${activeFor} · ${row.turns}`)}`,
	);
	const activity = quoteActivity(row.activity);
	const third = item(
		`    ${row.stage === "working" && !row.stale && !row.attention ? shimmerText(activity, nowMs) : style.muted(activity)}`,
	);
	return [first, second, third];
};

const scheduledRowLine = (wake: ScheduledRowModel): DashboardLine => {
	const retry =
		wake.workKey === undefined && wake.label === undefined ? "wake" : "retry";
	const attempt =
		wake.attempt === undefined ? "" : ` · attempt ${wake.attempt}`;
	return item(
		`    ${style.warn("↻")} ${style.muted(`${retry} in ${wake.inSeconds}s${attempt}${wake.reason === undefined ? "" : ` · ${wake.reason}`}`)}`,
	);
};

const emptyWorkLine = (model: DashboardModel): DashboardLine => {
	const wake = model.pulse.nextWake;
	const suffix = wake === undefined ? "" : ` · next tick in ${wake.inSeconds}s`;
	return item(`  no active work — watching${suffix}`, style.muted);
};

const activityGlyph = (tone: "ok" | "bad" | "info") =>
	tone === "ok"
		? style.ok("✓")
		: tone === "bad"
			? style.bad("✗")
			: style.muted("·");

export const fleetViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly model: DashboardModel;
	readonly selectedIndex: number;
	readonly width: number;
	readonly footerText: string;
	readonly footerStyle?: (value: string) => string;
	readonly nowMs?: number;
}): readonly DashboardLine[] => {
	const { model } = input;
	const nowMs = input.nowMs ?? Date.now();
	const attention =
		model.attention.length === 0
			? []
			: [
					blank(),
					item(style.warn(`▲ ATTENTION (${model.attention.length})`)),
					...model.attention.map((entry) =>
						item(`  ${style.bad("●")} ${entry.text}`),
					),
				];
	const scheduled =
		model.work.length === 0
			? model.scheduled.filter((wake) => wake.reason !== undefined)
			: model.scheduled;
	const workTitle =
		`Agents${model.work.length === 0 ? "" : ` · ${model.work.length} running`}` +
		(scheduled.length > 0 ? ` · ${scheduled.length} scheduled` : "");
	const workLines =
		model.work.length === 0
			? [emptyWorkLine(model), ...scheduled.map(scheduledRowLine)]
			: [
					...model.work.flatMap((row, index) =>
						workRowLines(row, index === input.selectedIndex, nowMs),
					),
					...scheduled.map(scheduledRowLine),
				];
	const activityLines =
		model.activity.length === 0
			? [item("  nothing yet", style.muted)]
			: model.activity
					.slice(0, 8)
					.map((entry) =>
						item(
							`  ${cell(entry.ago, 12, style.dim)} ${activityGlyph(entry.tone)} ${entry.text}`,
						),
					);
	return [
		...input.header,
		...attention,
		section(workTitle),
		...workLines,
		blank(),
		section("Activity"),
		...activityLines,
		footer(input.footerText, input.footerStyle ?? style.muted),
	];
};
