import type { DashboardProjection, WorkStage } from "./projection.js";
import type { DashboardModel, FleetRowModel } from "./dashboard-model.js";
import {
	cell,
	emptyItem,
	fit,
	footer,
	item,
	row,
	section,
	type DashboardLine,
} from "./dashboard-render.js";
import { style } from "./style.js";

const stageStyle = (stage: WorkStage) => {
	switch (stage) {
		case "exploring":
			return style.stage.exploring;
		case "reading":
			return style.stage.reading;
		case "testing":
			return style.stage.testing;
		case "acting":
			return style.stage.acting;
		case "publishing":
			return style.stage.publishing;
		case "blocked":
			return style.stage.blocked;
		case "failed":
			return style.stage.failed;
		case "waiting":
			return style.stage.waiting;
	}
};

const checkStyle = (check: FleetRowModel["check"]) => {
	switch (check) {
		case "not-run":
			return style.check.notRun;
		case "running":
			return style.check.running;
		case "passed":
			return style.check.passed;
		case "failed":
			return style.check.failed;
	}
};

const statusDot = (stage: WorkStage) => stageStyle(stage)("●");

export const fleetCells = (width: number) => {
	const content = Math.max(30, width - 2);
	const fixed = 12 + 12 + 10 + 9 + 5;
	const name = Math.max(18, Math.min(34, Math.floor(content * 0.32)));
	const last = Math.max(8, content - fixed - name);
	return { name, stage: 12, age: 12, tokens: 10, check: 9, last };
};

const fleetHeader = (width: number): DashboardLine => {
	const cells = fleetCells(width);
	return row([
		style.muted(cell("work", cells.name)),
		style.muted(cell("stage", cells.stage)),
		style.muted(cell("age/turn", cells.age)),
		style.muted(cell("tokens", cells.tokens)),
		style.muted(cell("check", cells.check)),
		style.muted("last"),
	]);
};

const fleetSeparator = (width: number): DashboardLine => {
	const cells = fleetCells(width);
	return row([
		style.muted(cell("─".repeat(cells.name), cells.name)),
		style.muted(cell("─".repeat(cells.stage), cells.stage)),
		style.muted(cell("─".repeat(cells.age), cells.age)),
		style.muted(cell("─".repeat(cells.tokens), cells.tokens)),
		style.muted(cell("─".repeat(cells.check), cells.check)),
		style.muted("─".repeat(cells.last)),
	]);
};

const fleetRow = (
	rowModel: FleetRowModel,
	index: number,
	selectedIndex: number,
	width: number,
): DashboardLine => {
	const cells = fleetCells(width);
	const selected = index === selectedIndex;
	const marker = selected ? "›" : " ";
	const text = `│ ${[
		cell(
			`${marker} ${statusDot(rowModel.stage)} ${rowModel.label}`,
			cells.name,
		),
		cell(rowModel.stage, cells.stage, stageStyle(rowModel.stage)),
		cell(
			rowModel.ageTurn,
			cells.age,
			rowModel.stale ? style.muted : style.value,
		),
		cell(rowModel.tokens, cells.tokens, style.value),
		cell(rowModel.check, cells.check, checkStyle(rowModel.check)),
		fit(
			rowModel.stale ? `stale · ${rowModel.last}` : rowModel.last,
			cells.last,
		),
	].join(" ")}`;
	return {
		text: rowModel.stale && !selected ? style.row.stale(text) : text,
		selected,
	};
};

export const fleetViewLines = (input: {
	readonly header: readonly DashboardLine[];
	readonly projection: DashboardProjection;
	readonly model: DashboardModel;
	readonly selectedIndex: number;
	readonly width: number;
	readonly debug: boolean;
	readonly feedOffset: number;
}): readonly DashboardLine[] => {
	const feed = input.debug
		? input.projection.debugEvents
		: input.projection.timeline;
	return [
		...input.header,
		section("RUNNING WORK", style.border),
		fleetHeader(input.width),
		fleetSeparator(input.width),
		...(input.model.running.length === 0
			? [emptyItem(style.muted)]
			: input.model.running.map((work, index) =>
					fleetRow(work, index, input.selectedIndex, input.width),
				)),
		section("SCHEDULED / BACKOFF", style.border),
		...(input.projection.scheduledWakes.length === 0
			? [emptyItem(style.muted)]
			: input.projection.scheduledWakes.slice(0, 5).map((wake) => {
					const dueInMs = Math.max(0, wake.dueAtMs - Date.now());
					const seconds = Math.ceil(dueInMs / 1000);
					return item(
						`↻ in ${seconds}s${wake.reason === undefined ? "" : ` ${wake.reason}`}`,
						style.muted,
					);
				})),
		section("RECENT COMPLETIONS", style.border),
		...(input.projection.completed.length === 0
			? [emptyItem(style.muted)]
			: input.projection.completed.map((completion) =>
					item(
						`${completion.status} ${completion.workKey} ${completion.message}`,
					),
				)),
		section("DIAGNOSTICS", style.border),
		...(input.projection.diagnostics.length === 0
			? [emptyItem(style.muted)]
			: input.projection.diagnostics.map((diagnostic) =>
					item(diagnostic, style.status.error),
				)),
		section(input.debug ? "DEBUG EVENTS" : "TIMELINE", style.border),
		...(feed.length === 0
			? [emptyItem(style.muted)]
			: feed
					.slice(input.feedOffset, input.feedOffset + 8)
					.map((entry) => item(entry))),
		footer(
			"↑/↓ select · enter details · c config · r force tick · g refresh · d debug · q shutdown",
			style.muted,
		),
	];
};
