import { matchesKey, parseKey, type Component } from "./pi-tui/index.ts";
import { configViewLines } from "./config-view.js";
import { dashboardModelFrom, type DashboardModel } from "./dashboard-model.js";
import {
	renderLines,
	asLine,
	type DashboardLine,
	maxScroll,
} from "./dashboard-render.js";
import { debugViewLines } from "./debug-view.js";
import { detailBodyLines, detailViewLines } from "./detail-view.js";
import { fleetViewLines } from "./fleet-view.js";
import type { DashboardProjection, TuiStatus } from "./projection.js";
import { style } from "./style.js";

export interface DashboardActions {
	readonly tick: () => void;
	readonly refresh: () => void;
	readonly toggleDebug: () => void;
	readonly shutdown: () => void;
	readonly openUrl?: (url: string) => void;
	readonly height?: () => number;
	readonly requestRender?: () => void;
}

type ViewMode = "fleet" | "debug" | "config" | "detail";

const statusGlyph = (status: TuiStatus) => {
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

const statusStyle = (status: TuiStatus) => {
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

export class PlotDashboard implements Component {
	private projection: DashboardProjection;
	private mode: ViewMode = "fleet";
	private selectedIndex = 0;
	private scrollOffset = 0;
	private confirmQuit = false;
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
		if (matchesKey(data, "ctrl+c")) {
			this.actions.shutdown();
			return;
		}
		if (this.confirmQuit) {
			if (key === "q") {
				this.actions.shutdown();
				return;
			}
			this.confirmQuit = false;
			if (key === "escape" || key === "esc") return;
		}
		if (key === "q") this.confirmQuit = true;
		else if (key === "t") this.actions.tick();
		else if (key === "g") this.actions.refresh();
		else if (key === "o") this.openSelectedUrl();
		else if (key === "d") {
			this.actions.toggleDebug();
			this.changeMode(this.mode === "debug" ? "fleet" : "debug");
		} else if (key === "c")
			this.changeMode(this.mode === "config" ? "fleet" : "config");
		else if (key === "enter" || key === "return") this.changeMode("detail");
		else if (key === "escape" || key === "esc") this.changeMode("fleet");
		else if (key === "j" || key === "down") this.moveDown();
		else if (key === "k" || key === "up") this.moveUp();
	}

	render(width: number): string[] {
		const model = dashboardModelFrom(this.projection);
		this.selectedIndex = Math.min(
			this.selectedIndex,
			Math.max(0, model.work.length - 1),
		);
		const header = this.header(model);
		const selected = model.work[this.selectedIndex]?.work;
		const viewportRows = this.viewportRows();
		const lines =
			this.mode === "config"
				? this.scrolled(
						configViewLines(this.projection, header),
						header.length,
						viewportRows,
					)
				: this.mode === "detail"
					? detailViewLines({
							header,
							selected,
							scrollOffset: this.clampedDetailScroll(selected, viewportRows),
							viewportRows,
						})
					: this.mode === "debug"
						? debugViewLines({
								projection: this.projection,
								header,
								scrollOffset: this.clampedFeedScroll(
									this.projection.debugEvents,
									viewportRows,
								),
								viewportRows,
							})
						: fleetViewLines({
								header,
								model,
								selectedIndex: this.selectedIndex,
								width,
								maxRows: Math.max(1, (this.actions.height?.() ?? 24) - 1),
								...this.fleetFooter(),
							});
		return ["", ...renderLines(lines, width, style.row.selected)];
	}

	private fleetFooter(): {
		readonly footerText: string;
		readonly footerStyle?: (value: string) => string;
	} {
		if (this.confirmQuit)
			return {
				footerText: "shut down the fleet? q confirm · esc cancel",
				footerStyle: style.warn,
			};
		return {
			footerText:
				"↑↓ select   enter details   o open   t tick   c config   d debug   q quit",
		};
	}

	private openSelectedUrl(): void {
		const model = dashboardModelFrom(this.projection);
		const selected = model.work[this.selectedIndex];
		const url =
			selected === undefined && this.mode === "fleet"
				? model.completed[0]?.url
				: selected?.work.url;
		if (url !== undefined) this.actions.openUrl?.(url);
	}

	private desiredLiveRenderInterval(): number | undefined {
		if (this.projection.running.size > 0) return 125;
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
		if (this.mode === "fleet") this.selectedIndex++;
		else this.scrollOffset++;
	}

	private moveUp(): void {
		if (this.mode === "fleet")
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
		else this.scrollOffset = Math.max(0, this.scrollOffset - 1);
	}

	private header(model: DashboardModel): readonly DashboardLine[] {
		const p = this.projection;
		const identity = p.workflowName;
		const pulse = model.pulse;
		const tickText =
			pulse.tick === undefined
				? style.muted("no ticks yet")
				: `${style.text(`tick #${pulse.tick.id}`)}${style.muted(
						` · ${pulse.tick.ago}`,
					)}${pulse.tick.found > 0 ? style.muted(` · found ${pulse.tick.found}`) : ""}`;
		const wakeText =
			pulse.nextWake !== undefined
				? `${style.muted("next wake in ")}${style.text(`${pulse.nextWake.inSeconds}s`)}`
				: pulse.runningCount > 0
					? undefined
					: style.muted("no wake scheduled");
		const runningValue =
			pulse.maxConcurrentRuns === undefined
				? String(pulse.runningCount)
				: `${pulse.runningCount}/${pulse.maxConcurrentRuns}`;
		const runningText =
			pulse.runningCount > 0
				? style.ok(`${runningValue} agents active`)
				: style.muted(`${runningValue} agents active`);
		const metrics = [
			runningText,
			style.muted(`${pulse.totalTokens} tokens`),
			...(pulse.totalCost === undefined ? [] : [style.muted(pulse.totalCost)]),
			style.muted(`${pulse.throughput} ${pulse.throughputGraph}`),
		];
		return [
			asLine(
				`${style.border("╭─ ")}${style.brand("PLOT")}  ${style.muted(identity)}${style.muted("  ")}${statusGlyph(p.status)} ${statusStyle(p.status)(p.status)}`,
			),
			asLine(style.border("│")),
			asLine(`${style.border("│  ")}${metrics.join(style.dim("      "))}`),
			asLine(
				`${style.border("│  ")}${[tickText, ...(wakeText === undefined ? [] : [wakeText])].join(style.dim("      "))}`,
			),
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
		selected:
			| ReturnType<typeof dashboardModelFrom>["work"][number]["work"]
			| undefined,
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
