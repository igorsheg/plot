import type {
	CompletedRowModel,
	DashboardModel,
	ScheduledRowModel,
	WorkRowModel,
} from "./dashboard-model.js";
import {
	blank,
	footer,
	item,
	section,
	spread,
	type DashboardLine,
} from "./dashboard-render.js";
import { shimmerText, quoteActivity } from "./shimmer.js";
import { style } from "./style.js";

const rowGlyph = (row: WorkRowModel) => {
	if (row.attention) return style.bad("▲");
	if (row.stale) return style.dim("○");
	if (row.status === "pending") return style.muted("◌");
	if (row.status === "draining") return style.warn("◌");
	return style.ok("●");
};

const workRowLines = (
	row: WorkRowModel,
	selected: boolean,
	nowMs: number,
	width: number,
): readonly DashboardLine[] => {
	const marker = selected ? style.label("›") : " ";
	const label = row.stale ? style.row.stale(row.label) : style.text(row.label);
	const meta = row.meta.length === 0 ? "" : style.dim(row.meta);
	const activity = quoteActivity(row.activity);
	const live =
		row.attempt?.stage === "working" && !row.stale && !row.attention
			? shimmerText(activity, nowMs)
			: style.muted(activity);
	return [
		spread(`${marker} ${rowGlyph(row)} ${label}`, meta, width),
		item(`    ${live}`),
		blank(),
	];
};

const scheduledRowLine = (
	wake: ScheduledRowModel,
	showReason: boolean,
): DashboardLine => {
	const retry =
		wake.workKey === undefined && wake.label === undefined ? "wake" : "retry";
	const attempt =
		wake.attempt === undefined ? "" : ` · attempt ${wake.attempt}`;
	const reason =
		showReason && wake.reason !== undefined ? ` · ${wake.reason}` : "";
	return item(
		`  ${style.warn("↻")} ${style.muted(`${retry} in ${wake.inSeconds}s${attempt}${reason}`)}`,
	);
};

const completionRowLine = (
	row: CompletedRowModel,
	width: number,
): DashboardLine => {
	const glyph = row.tone === "ok" ? style.ok("✓") : style.bad("✗");
	const message =
		row.message === "completed" || row.message === row.status
			? undefined
			: row.message;
	const right =
		row.tone === "ok"
			? (row.meta ?? row.ago)
			: [
					row.status,
					...(message === undefined ? [] : [message]),
					row.meta ?? row.ago,
				].join(" · ");
	return spread(
		`  ${glyph} ${style.text(row.label)}`,
		style.muted(right),
		width,
	);
};

const emptyWorkLine = (): DashboardLine =>
	item("  no active work", style.muted);

const clampWorkViewport = (
	workLines: readonly DashboardLine[],
	selectedIndex: number,
	availableRows: number,
): readonly DashboardLine[] => {
	if (workLines.length <= availableRows) return workLines;
	const selectedStart = Math.max(0, selectedIndex * 3);
	if (availableRows <= 3)
		return workLines.slice(selectedStart, selectedStart + availableRows);
	const selectedEnd = Math.min(workLines.length - 1, selectedStart + 2);
	const maxOffset = Math.max(0, workLines.length - availableRows);
	const offset = Math.min(
		maxOffset,
		Math.max(0, selectedEnd - availableRows + 1),
	);
	const visible = workLines.slice(offset, offset + availableRows);
	if (offset === 0)
		return [...visible.slice(0, -1), item(style.muted("    … more below"))];
	if (offset >= maxOffset)
		return [item(style.muted("    … more above")), ...visible.slice(1)];
	return [
		item(style.muted("    … more above")),
		...visible.slice(1, -1),
		item(style.muted("    … more below")),
	];
};

export const runsViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly model: DashboardModel;
	readonly selectedIndex: number;
	readonly width: number;
	readonly footerText: string;
	readonly footerStyle?: (value: string) => string;
	readonly maxRows?: number;
	readonly nowMs?: number;
}): readonly DashboardLine[] => {
	const { model } = input;
	const nowMs = input.nowMs ?? Date.now();
	const attentionBlock =
		model.attention.length === 0
			? []
			: [
					section("Attention", style.warn),
					blank(),
					...model.attention.map((entry) =>
						item(`  ${style.bad("●")} ${entry.text}`),
					),
					blank(),
				];
	const sourceBlock =
		model.sources.length === 0
			? []
			: [
					section("Sources", style.warn),
					blank(),
					...model.sources.flatMap((source) => [
						item(
							`  ${style.bad("●")} ${style.text(source.label)} ${style.warn(source.readiness)}`,
						),
						...(source.progress === undefined && source.message === undefined
							? []
							: [
									item(`    ${source.progress ?? source.message}`, style.muted),
								]),
						...(source.actions.length === 0
							? []
							: [
									item(
										`    ${source.actions.map((action) => `[s] ${action.label}`).join(" · ")}`,
										style.label,
									),
								]),
					]),
					blank(),
				];
	const scheduled =
		model.work.length === 0
			? model.scheduled.filter((wake) => wake.reason !== undefined)
			: [];
	const workLines =
		model.work.length === 0
			? [
					emptyWorkLine(),
					...scheduled.map((wake) =>
						scheduledRowLine(
							wake,
							wake.reason === undefined ||
								!model.attention.some((entry) =>
									entry.text.includes(wake.reason ?? ""),
								),
						),
					),
					blank(),
				]
			: model.work.flatMap((row, index) =>
					workRowLines(row, index === input.selectedIndex, nowMs, input.width),
				);
	const lastRun = model.completed[0];
	const completionBlock =
		model.work.length === 0 && lastRun !== undefined
			? [
					section("Last run"),
					blank(),
					completionRowLine(lastRun, input.width),
					blank(),
				]
			: [];
	const workChromeRows = 2; // section + breathing row
	const chromeRows =
		input.header.length +
		sourceBlock.length +
		attentionBlock.length +
		workChromeRows +
		completionBlock.length +
		1;
	const availableWorkRows =
		input.maxRows === undefined
			? workLines.length
			: Math.max(1, input.maxRows - chromeRows);
	const visibleWorkLines = clampWorkViewport(
		workLines,
		input.selectedIndex,
		availableWorkRows,
	);
	return [
		...input.header,
		...sourceBlock,
		...attentionBlock,
		section(model.work.length === 0 ? "Watching" : "Work"),
		blank(),
		...visibleWorkLines,
		...completionBlock,
		footer(input.footerText, input.footerStyle ?? style.muted),
	];
};
