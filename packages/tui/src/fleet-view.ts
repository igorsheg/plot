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
	spread,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const rowGlyph = (row: WorkRowModel, nowMs: number) => {
	if (row.attention) return style.bad("●");
	if (row.stale) return style.dim("○");
	if (row.stage === "waiting" || row.stage === "starting")
		return style.muted("◌");
	const frame =
		spinnerFrames[
			(Math.floor(nowMs / 1000) + row.work.eventCount) % spinnerFrames.length
		]!;
	return style.ok(frame);
};

const workRowLines = (
	row: WorkRowModel,
	selected: boolean,
	width: number,
	nowMs: number,
): readonly DashboardLine[] => {
	const marker = selected ? style.label("›") : " ";
	const label = row.stale ? style.row.stale(row.label) : style.text(row.label);
	const meta = `${cell(row.stage, 10, style.stage[row.stage])} ${style.muted(
		`${row.age} · ${row.turns} · ${row.tokens}`,
	)}`;
	const first = spread(
		`${marker} ${rowGlyph(row, nowMs)} ${label}`,
		meta,
		width,
		selected,
	);
	const second = spread(
		`     ${style.muted(row.activity)}`,
		style.dim(row.lastEventAgo),
		width,
		selected,
	);
	return [first, second];
};

const scheduledRowLine = (wake: ScheduledRowModel): DashboardLine =>
	item(
		`  ↻ wake in ${wake.inSeconds}s${wake.reason === undefined ? "" : ` · ${wake.reason}`}`,
		style.muted,
	);

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
	const { model, width } = input;
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
		`WORK · ${model.work.length} running` +
		(scheduled.length > 0 ? ` · ${scheduled.length} scheduled` : "");
	const workLines =
		model.work.length === 0
			? [emptyWorkLine(model), ...scheduled.map(scheduledRowLine)]
			: [
					...model.work.flatMap((row, index) =>
						workRowLines(row, index === input.selectedIndex, width, nowMs),
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
		section("ACTIVITY"),
		...activityLines,
		footer(input.footerText, input.footerStyle ?? style.muted),
	];
};
