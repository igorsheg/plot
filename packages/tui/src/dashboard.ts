import { matchesKey, parseKey, type Component } from "./terminal-ui.js";
import { configViewLines } from "./config-view.js";
import {
	dashboardModelFrom,
	entryMatchesSelection,
	entrySelection,
	tableEntries,
	type DashboardModel,
	type Selection,
	type TableEntry,
	type WorkRowModel,
	type WorkSubjectModel,
} from "./dashboard-model.js";
import {
	renderLines,
	asLine,
	footer,
	type DashboardLine,
	maxScroll,
} from "./dashboard-render.js";
import { debugViewLines } from "./debug-view.js";
import { detailBodyLines, detailViewLines } from "./detail-view.js";
import { processTableViewLines } from "./process-table-view.js";
import { subjectViewLines } from "./subject-view.js";
import type { DashboardProjection, DashboardStatus } from "@plot/projection";
import { style } from "./style.js";

export interface DashboardActions {
	readonly tick: () => void;
	readonly refresh: () => void;
	readonly toggleDebug: () => void;
	readonly stop: () => void;
	readonly detach: () => void;
	readonly sourceAction?: (input: {
		readonly sourceId: string;
		readonly requirementId: string;
		readonly actionId: string;
	}) => void;
	readonly cancelSourceAction?: (actionRunId: string) => void;
	readonly openUrl?: (url: string) => void;
	readonly height?: () => number;
	readonly requestRender?: () => void;
}

type ViewMode = "process-table" | "debug" | "config" | "detail" | "subject";

const statusGlyph = (status: DashboardStatus) => {
	switch (status) {
		case "running":
			return style.status.running("◉");
		case "error":
			return style.status.error("●");
		case "shutting_down":
			return style.status.warning("◉");
		case "stopped":
			return style.dim("○");
		case "starting":
			return style.muted("◌");
		default:
			return style.muted("◉");
	}
};

const statusStyle = (status: DashboardStatus) => {
	switch (status) {
		case "running":
			return style.status.running;
		case "error":
			return style.status.error;
		case "shutting_down":
			return style.status.warning;
		case "stopped":
			return style.muted;
		default:
			return style.status.idle;
	}
};

export class Dashboard implements Component {
	private projection: DashboardProjection;
	private mode: ViewMode = "process-table";
	private selection: Selection | undefined;
	private lastEntryIndex = 0;
	private subjectViewKey: string | undefined;
	private detailReturn: "process-table" | "subject" = "process-table";
	private scrollOffset = 0;
	private showHelp = false;
	private confirmingStop = false;
	private liveRenderTimer: ReturnType<typeof setInterval> | undefined;
	private liveRenderIntervalMs: number | undefined;
	private liveUpdatesActive = false;
	private readonly actions: DashboardActions;

	constructor(projection: DashboardProjection, actions: DashboardActions) {
		this.projection = projection;
		this.actions = actions;
	}

	setProjection(projection: DashboardProjection): void {
		this.projection = projection;
		this.syncLiveRenderTimer();
	}

	startLiveUpdates(): void {
		this.liveUpdatesActive = true;
		this.syncLiveRenderTimer();
	}

	stopLiveUpdates(): void {
		this.liveUpdatesActive = false;
		if (this.liveRenderTimer !== undefined) clearInterval(this.liveRenderTimer);
		this.liveRenderTimer = undefined;
		this.liveRenderIntervalMs = undefined;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const key = parseKey(data);
		const ctrlC = matchesKey(data, "ctrl+c");
		if (this.confirmingStop) {
			if (
				ctrlC ||
				key === "q" ||
				key === "enter" ||
				key === "return" ||
				key === "y"
			) {
				this.confirmingStop = false;
				this.actions.stop();
			} else if (key === "d") this.actions.detach();
			else if (key === "escape" || key === "esc" || key === "n") {
				this.confirmingStop = false;
				this.actions.requestRender?.();
			}
			return;
		}
		if (ctrlC || key === "q") {
			this.confirmingStop = true;
			this.showHelp = false;
			this.actions.requestRender?.();
			return;
		}
		if ((key === "escape" || key === "esc") && this.showHelp) {
			this.showHelp = false;
			return;
		}
		if (key === "d") this.actions.detach();
		else if (key === "?") this.showHelp = !this.showHelp;
		else if (key === "t") this.actions.tick();
		else if (key === "g") this.actions.refresh();
		else if (key === "o") this.openSelectedUrl();
		else if (key === "s") this.runSourceAction();
		else if (key === "x") this.cancelSourceAction();
		else if (key === "b") {
			this.actions.toggleDebug();
			this.changeMode(this.mode === "debug" ? "process-table" : "debug");
		} else if (key === "c")
			this.changeMode(this.mode === "config" ? "process-table" : "config");
		else if (key === "enter" || key === "return") this.drill();
		else if (key === "escape" || key === "esc") this.goBack();
		else if (key === "j" || key === "down") this.moveDown();
		else if (key === "k" || key === "up") this.moveUp();
	}

	render(width: number): string[] {
		const model = dashboardModelFrom(this.projection);
		// Resolve the keyed selection against the fresh rows so it survives
		// re-sorts; heals to a nearby entry when the selected row is gone. Only
		// the table windows rows, so only its selection heals against entries —
		// detail/subject modes legitimately point at rows outside the window.
		if (this.mode === "process-table") this.selectedEntry(tableEntries(model));
		const header = this.header(model);
		const viewportRows = this.viewportRows();
		const maxRows = Math.max(1, (this.actions.height?.() ?? 24) - 1);
		let lines: readonly DashboardLine[];
		switch (this.mode) {
			case "config":
				lines = this.scrolled(
					configViewLines(this.projection, header),
					header.length,
					viewportRows,
				);
				break;
			case "detail": {
				const selected = this.detailRow(model);
				lines = detailViewLines({
					header,
					selected,
					scrollOffset: this.clampedDetailScroll(selected, viewportRows),
					viewportRows,
				});
				break;
			}
			case "subject":
				lines = subjectViewLines({
					subject: this.subjectModel(model),
					selectedIndex: this.subjectChildIndex(model),
					width,
					maxRows,
				});
				break;
			case "debug":
				lines = debugViewLines({
					projection: this.projection,
					header,
					scrollOffset: this.clampedFeedScroll(
						this.projection.debugEvents,
						viewportRows,
					),
					viewportRows,
				});
				break;
			case "process-table":
				lines = processTableViewLines({
					header,
					model,
					selection: this.selection,
					width,
					maxRows,
					...this.processTableFooter(),
				});
				break;
		}
		const visibleLines = this.confirmingStop
			? [
					...lines.slice(0, -1),
					footer(
						`Stop ${this.projection.workflowName}? enter/q yes · d detach instead · esc cancel`,
						style.warn,
					),
				]
			: lines;
		return ["", ...renderLines(visibleLines, width, style.row.selected)];
	}

	private processTableFooter(): {
		readonly footerText: string;
		readonly footerStyle?: (value: string) => string;
	} {
		if (this.showHelp)
			return {
				footerText:
					"↑↓ select · enter details · o open · s setup · x cancel · t tick · c config · b debug · d detach · q stop · ? hide",
			};
		return { footerText: "? help · d detach · q stop" };
	}

	private runSourceAction(): void {
		const source = dashboardModelFrom(this.projection).sources.find(
			(candidate) => candidate.actionRunId === undefined,
		);
		const action = source?.actions.find((candidate) => !candidate.disabled);
		if (
			source === undefined ||
			source.requirementId === undefined ||
			action === undefined
		)
			return;
		this.actions.sourceAction?.({
			sourceId: source.sourceId,
			requirementId: source.requirementId,
			actionId: action.id,
		});
	}

	private cancelSourceAction(): void {
		const actionRunId = dashboardModelFrom(this.projection).sources.find(
			(source) => source.actionRunId !== undefined,
		)?.actionRunId;
		if (actionRunId !== undefined)
			this.actions.cancelSourceAction?.(actionRunId);
	}

	private openSelectedUrl(): void {
		const model = dashboardModelFrom(this.projection);
		// Resolve against every row, not the windowed table entries: a child
		// selected in the Subject view may be outside the table window. Before
		// the first render no selection exists yet; fall back to the first row.
		const row =
			this.detailRow(model) ??
			(this.selection === undefined ? model.work[0] : undefined);
		if (row !== undefined) {
			if (row.work.url !== undefined) this.actions.openUrl?.(row.work.url);
			return;
		}
		// A Subject has no URL of its own; with no rows at all, fall back to
		// the latest completed run.
		if (this.selection !== undefined || model.work.length > 0) return;
		const url =
			this.mode === "process-table" ? model.completed[0]?.url : undefined;
		if (url !== undefined) this.actions.openUrl?.(url);
	}

	private desiredLiveRenderInterval(): number | undefined {
		if (this.projection.attempts.size > 0) return 125;
		if (
			this.projection.scheduledWakes.length > 0 ||
			this.projection.pulse !== undefined
		)
			return 1_000;
		return undefined;
	}

	private syncLiveRenderTimer(): void {
		// Projection updates can arrive from late async callbacks after the
		// TUI begins shutting down; the render clock may only exist between
		// startLiveUpdates and stopLiveUpdates.
		if (!this.liveUpdatesActive) return;
		const next = this.desiredLiveRenderInterval();
		if (next === this.liveRenderIntervalMs) return;
		if (this.liveRenderTimer !== undefined) clearInterval(this.liveRenderTimer);
		this.liveRenderIntervalMs = next;
		if (next === undefined) {
			this.liveRenderTimer = undefined;
			return;
		}
		const timer = setInterval(() => this.actions.requestRender?.(), next);
		// A stray render clock must never hold the process open.
		timer.unref?.();
		this.liveRenderTimer = timer;
	}

	private viewportRows(): number {
		const terminalRows = this.actions.height?.() ?? 24;
		return Math.max(4, terminalRows - 6);
	}

	private changeMode(mode: ViewMode): void {
		this.mode = mode;
		this.scrollOffset = 0;
	}

	private moveDown(): void {
		if (this.mode === "process-table") this.moveTableSelection(1);
		else if (this.mode === "subject") this.moveSubjectSelection(1);
		else this.scrollOffset++;
	}

	private moveUp(): void {
		if (this.mode === "process-table") this.moveTableSelection(-1);
		else if (this.mode === "subject") this.moveSubjectSelection(-1);
		else this.scrollOffset = Math.max(0, this.scrollOffset - 1);
	}

	/** Heals `selection` against the current entries and returns its match. */
	private selectedEntry(
		entries: readonly TableEntry[],
	): { readonly entry: TableEntry; readonly index: number } | undefined {
		if (entries.length === 0) {
			this.selection = undefined;
			this.lastEntryIndex = 0;
			return undefined;
		}
		const selection = this.selection;
		let index =
			selection === undefined
				? -1
				: entries.findIndex((entry) => entryMatchesSelection(entry, selection));
		if (index < 0) index = Math.min(this.lastEntryIndex, entries.length - 1);
		const entry = entries[index];
		if (entry === undefined) return undefined;
		this.selection = entrySelection(entry);
		this.lastEntryIndex = index;
		return { entry, index };
	}

	private moveTableSelection(delta: number): void {
		const entries = tableEntries(dashboardModelFrom(this.projection));
		const selected = this.selectedEntry(entries);
		if (selected === undefined) return;
		const index = Math.min(
			entries.length - 1,
			Math.max(0, selected.index + delta),
		);
		const next = entries[index];
		if (next === undefined) return;
		this.selection = entrySelection(next);
		this.lastEntryIndex = index;
	}

	private moveSubjectSelection(delta: number): void {
		const model = dashboardModelFrom(this.projection);
		const subject = this.subjectModel(model);
		if (subject === undefined || subject.work.length === 0) return;
		const index = Math.min(
			subject.work.length - 1,
			Math.max(0, this.subjectChildIndex(model) + delta),
		);
		const row = subject.work[index];
		if (row !== undefined)
			this.selection = { kind: "work", workKey: row.work.workKey };
	}

	/** enter: Subject header drills into its children, Work opens details. */
	private drill(): void {
		if (this.mode === "process-table") {
			const selected = this.selectedEntry(
				tableEntries(dashboardModelFrom(this.projection)),
			);
			if (selected === undefined) return;
			if (selected.entry.kind === "subject") {
				this.subjectViewKey = selected.entry.subject.key;
				const first = selected.entry.subject.work[0];
				if (first !== undefined)
					this.selection = { kind: "work", workKey: first.work.workKey };
				this.changeMode("subject");
				return;
			}
			this.detailReturn = "process-table";
			this.changeMode("detail");
			return;
		}
		if (
			this.mode === "subject" &&
			this.subjectModel(dashboardModelFrom(this.projection)) !== undefined
		) {
			this.detailReturn = "subject";
			this.changeMode("detail");
		}
	}

	/** esc: detail returns to its origin, Subject view returns to the table. */
	private goBack(): void {
		if (
			this.mode === "detail" &&
			this.detailReturn === "subject" &&
			this.subjectViewKey !== undefined
		) {
			this.changeMode("subject");
			return;
		}
		if (this.mode === "subject" && this.subjectViewKey !== undefined)
			this.selection = { kind: "subject", subjectKey: this.subjectViewKey };
		if (this.mode === "detail") this.reselectVisibleEntry();
		this.changeMode("process-table");
	}

	/** A child opened from the table may be windowed out on return; select its Subject instead. */
	private reselectVisibleEntry(): void {
		const selection = this.selection;
		if (selection?.kind !== "work") return;
		const model = dashboardModelFrom(this.projection);
		if (
			tableEntries(model).some((entry) =>
				entryMatchesSelection(entry, selection),
			)
		)
			return;
		const group = model.workGroups.find((candidate) =>
			candidate.work.some((row) => row.work.workKey === selection.workKey),
		);
		this.selection =
			group?.subject === undefined
				? undefined
				: { kind: "subject", subjectKey: group.subject.key };
	}

	private detailRow(model: DashboardModel): WorkRowModel | undefined {
		const selection = this.selection;
		if (selection?.kind !== "work") return undefined;
		return model.work.find((row) => row.work.workKey === selection.workKey);
	}

	private subjectModel(model: DashboardModel): WorkSubjectModel | undefined {
		return model.workGroups.find(
			(group) => group.subject?.key === this.subjectViewKey,
		)?.subject;
	}

	private subjectChildIndex(model: DashboardModel): number {
		const subject = this.subjectModel(model);
		if (subject === undefined) return 0;
		const selection = this.selection;
		const found =
			selection?.kind === "work"
				? subject.work.findIndex(
						(row) => row.work.workKey === selection.workKey,
					)
				: -1;
		const index = Math.max(0, found);
		const row = subject.work[index];
		if (row !== undefined)
			this.selection = { kind: "work", workKey: row.work.workKey };
		return index;
	}

	private header(model: DashboardModel): readonly DashboardLine[] {
		const p = this.projection;
		const pulse = model.pulse;
		const runningValue =
			pulse.maxConcurrentRuns === undefined
				? String(pulse.runningCount)
				: `${pulse.runningCount}/${pulse.maxConcurrentRuns}`;
		const metrics = [
			pulse.runningCount > 0
				? style.ok(`${runningValue} agents`)
				: style.muted(`${runningValue} agents`),
			style.muted(`${pulse.totalTokens} tokens`),
			...(pulse.totalCost === undefined ? [] : [style.muted(pulse.totalCost)]),
			style.muted(`${pulse.throughput} ${pulse.throughputGraph}`),
		];
		const watching =
			pulse.runningCount > 0
				? []
				: [
						...(pulse.tick === undefined
							? []
							: [style.muted(`tick #${pulse.tick.id} · ${pulse.tick.ago}`)]),
						...(pulse.nextTick === undefined
							? []
							: [
									`${style.muted("next tick in ")}${style.text(`${pulse.nextTick.inSeconds}s`)}`,
								]),
						...(pulse.nextWake === undefined
							? []
							: [
									`${style.muted(`${pulse.nextWake.kind === "retry" ? "retry" : "next wake"} in `)}${style.text(`${pulse.nextWake.inSeconds}s`)}`,
								]),
					];
		return [
			asLine(
				`${style.border("╭─ ")}${style.brand("PLOT")}  ${style.muted(p.workflowName)}${style.muted("  ")}${statusGlyph(p.status)} ${statusStyle(p.status)(p.status)}`,
			),
			asLine(style.border("│")),
			asLine(`${style.border("│  ")}${metrics.join(style.dim("      "))}`),
			...(watching.length === 0
				? []
				: [
						asLine(
							`${style.border("│  ")}${watching.join(style.dim("      "))}`,
						),
					]),
			asLine(style.border("│")),
		];
	}

	private scrolled(
		lines: readonly DashboardLine[],
		headerRows: number,
		viewportRows: number,
	): readonly DashboardLine[] {
		const footerRows = 1;
		const fixedHead = lines.slice(0, headerRows);
		const fixedFoot = lines.slice(-footerRows);
		const body = lines.slice(headerRows, -footerRows);
		this.scrollOffset = Math.min(
			this.scrollOffset,
			maxScroll(body, viewportRows),
		);
		return [
			...fixedHead,
			...body.slice(this.scrollOffset, this.scrollOffset + viewportRows),
			...fixedFoot,
		];
	}

	private clampedDetailScroll(
		selected: ReturnType<typeof dashboardModelFrom>["work"][number] | undefined,
		viewportRows: number,
	): number {
		const body = selected === undefined ? [] : detailBodyLines(selected);
		this.scrollOffset = Math.min(
			this.scrollOffset,
			maxScroll(body, viewportRows),
		);
		return this.scrollOffset;
	}

	private clampedFeedScroll(
		items: readonly string[],
		viewportRows: number,
	): number {
		this.scrollOffset = Math.min(
			this.scrollOffset,
			maxScroll(items, viewportRows),
		);
		return this.scrollOffset;
	}
}
