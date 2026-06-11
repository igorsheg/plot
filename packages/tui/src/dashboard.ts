import { matchesKey, parseKey, type Component } from "./pi-tui/index.ts";
import { configViewLines } from "./config-view.js";
import { dashboardModelFrom } from "./dashboard-model.js";
import {
	renderLines,
	row,
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
	readonly height?: () => number;
}

type ViewMode = "fleet" | "debug" | "config" | "detail";

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
	private readonly actions: DashboardActions;

	constructor(projection: DashboardProjection, actions: DashboardActions) {
		this.projection = projection;
		this.actions = actions;
	}

	setProjection(projection: DashboardProjection): void {
		this.projection = projection;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const key = parseKey(data);
		if (matchesKey(data, "ctrl+c") || key === "q") this.actions.shutdown();
		else if (key === "r") this.actions.tick();
		else if (key === "g") this.actions.refresh();
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
			Math.max(0, model.running.length - 1),
		);
		const header = this.header(model.running.length, model.totalTokens);
		const selected = model.running[this.selectedIndex]?.work;
		const viewportRows = this.viewportRows();
		const lines =
			this.mode === "config"
				? this.scrolled(configViewLines(this.projection, header), viewportRows)
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
								projection: this.projection,
								model,
								selectedIndex: this.selectedIndex,
								width,
								debug: false,
								feedOffset: 0,
							});
		return renderLines(lines, width, style.row.selected);
	}

	private viewportRows(): number {
		const terminalRows = this.actions.height?.() ?? 24;
		return Math.max(4, terminalRows - 8);
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

	private header(
		runningCount: number,
		totalTokens: string,
	): readonly DashboardLine[] {
		const p = this.projection;
		const runtime = p.runtime;
		const agent =
			runtime.provider && runtime.model
				? `${runtime.provider}/${runtime.model}`
				: (runtime.model ?? runtime.provider ?? "unknown");
		const skills =
			runtime.skills.length === 0
				? "none"
				: runtime.skills.length <= 2
					? runtime.skills.join(",")
					: `${runtime.skills.length} skills`;
		const diagnosticCount = p.diagnostics.length;
		const statusText =
			diagnosticCount > 0 ? `${p.status} with diagnostics` : p.status;
		const workState =
			runningCount === 0 && p.scheduledWakes.length === 0 ? "idle" : "active";
		const nextWake = p.scheduledWakes[0];
		const nextWakeText =
			nextWake === undefined
				? "none"
				: `${Math.ceil(Math.max(0, nextWake.dueAtMs - Date.now()) / 1000)}s`;
		return [
			asLine(style.appTitle("╭─ PLOT STATUS")),
			row([
				`${style.label("Status: ")}${statusStyle(p.status)(statusText)}`,
				`${style.label("Work: ")}${style.status.running(String(runningCount))}${style.muted(" running · ")}${style.status.success(String(p.completed.length))}${style.muted(" completed · ")}${diagnosticCount > 0 ? style.status.error(String(diagnosticCount)) : style.muted("0")}${style.muted(" diagnostics")}`,
				`${style.label("Tokens: ")}${style.value(totalTokens)}`,
			]),
			row([
				`${style.label("Agent: ")}${style.value(agent)}`,
				`${style.muted("thinking ")}${style.value(runtime.thinking ?? "default")}`,
				`${style.muted("skills ")}${style.value(skills)}`,
				`${style.muted("cwd ")}${style.value(runtime.cwdName)}`,
			]),
			row([
				`${style.label("Workflow: ")}${style.value(p.workflowName)}`,
				`${style.label("Mode: ")}${style.value(workState)}`,
				`${style.label("Next wake: ")}${nextWake === undefined ? style.muted(nextWakeText) : style.value(nextWakeText)}`,
			]),
		];
	}

	private scrolled(
		lines: readonly DashboardLine[],
		viewportRows: number,
	): readonly DashboardLine[] {
		const headerRows = 4;
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
			| ReturnType<typeof dashboardModelFrom>["running"][number]["work"]
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
