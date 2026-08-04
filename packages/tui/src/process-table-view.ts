import {
	maxGroupChildren,
	type CompletedRowModel,
	type DashboardModel,
	type ScheduledRowModel,
	type Selection,
	type WorkRowModel,
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

const liveActivity = (row: WorkRowModel, nowMs: number): string => {
	const activity = quoteActivity(row.activity);
	return row.attempt?.stage === "working" && !row.stale && !row.attention
		? shimmerText(activity, nowMs)
		: style.muted(activity);
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
	return [
		spread(`${marker} ${rowGlyph(row)} ${label}`, meta, width),
		item(`    ${liveActivity(row, nowMs)}`),
		blank(),
	];
};

/** One-line child row used inside Subject groups and the Subject drill-down. */
export const denseWorkRowLine = (
	row: WorkRowModel,
	selected: boolean,
	width: number,
	nowMs: number,
	branch?: "middle" | "last",
): DashboardLine => {
	const marker = selected ? style.label("›") : " ";
	const tree =
		branch === undefined
			? ""
			: `${style.border(branch === "last" ? "└─" : "├─")} `;
	const label = row.stale ? style.row.stale(row.label) : style.text(row.label);
	return spread(
		`${marker} ${tree}${rowGlyph(row)} ${label}`,
		liveActivity(row, nowMs),
		width,
		selected,
	);
};

const rowSelected = (
	selection: Selection | undefined,
	row: WorkRowModel,
): boolean =>
	selection?.kind === "work" && selection.workKey === row.work.workKey;

const renderedWork = (
	model: DashboardModel,
	selection: Selection | undefined,
	nowMs: number,
	width: number,
): {
	readonly lines: readonly DashboardLine[];
	readonly selectedStart: number;
} => {
	const lines: DashboardLine[] = [];
	let selectedStart = 0;
	for (const group of model.workGroups) {
		if (group.subject === undefined) {
			for (const row of group.work) {
				const selected = rowSelected(selection, row);
				if (selected) selectedStart = lines.length;
				lines.push(...workRowLines(row, selected, nowMs, width));
			}
			continue;
		}
		const subjectSelected =
			selection?.kind === "subject" &&
			selection.subjectKey === group.subject.key;
		if (subjectSelected) selectedStart = lines.length;
		const marker = subjectSelected ? style.label("›") : " ";
		lines.push(
			spread(
				`${marker} ${style.label("◆")} ${style.text(group.subject.label)}`,
				style.muted(group.subject.meta),
				width,
				subjectSelected,
			),
		);
		const visible = group.work.slice(0, maxGroupChildren);
		const hidden = group.work.length - visible.length;
		for (const [index, row] of visible.entries()) {
			const selected = rowSelected(selection, row);
			if (selected) selectedStart = lines.length;
			lines.push(
				denseWorkRowLine(
					row,
					selected,
					width,
					nowMs,
					index === visible.length - 1 && hidden === 0 ? "last" : "middle",
				),
			);
		}
		if (hidden > 0)
			lines.push(
				item(
					`  ${style.border("└─")} ${style.muted(`… +${hidden} more · enter on subject to view all`)}`,
				),
			);
	}
	return { lines, selectedStart };
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

export const clampWorkViewport = (
	workLines: readonly DashboardLine[],
	selectedStart: number,
	availableRows: number,
): readonly DashboardLine[] => {
	if (workLines.length <= availableRows) return workLines;
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

export const processTableViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly model: DashboardModel;
	readonly selection?: Selection | undefined;
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
	const rendered = renderedWork(model, input.selection, nowMs, input.width);
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
			: rendered.lines;
	const lastRun = model.completed[0];
	const completionBlock =
		model.work.length === 0 && lastRun !== undefined
			? [
					section("Latest Agent Run"),
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
		rendered.selectedStart,
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
