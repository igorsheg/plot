import { truncateToWidth, type Component } from "./pi-tui/index.ts";

export type TextStyle = (value: string) => string;

export type DashboardLine = {
	readonly text: string;
	readonly selected?: boolean;
};

export const asLine = (text: string, selected = false): DashboardLine => ({
	text,
	selected,
});

export const fit = (value: string, width: number) =>
	truncateToWidth(value, Math.max(1, width), "…", true);

export const cell = (
	value: string,
	width: number,
	apply: TextStyle = (text) => text,
) => apply(fit(value, width));

export const row = (parts: readonly string[]) => asLine(`│ ${parts.join(" ")}`);
export const item = (value: string, apply?: TextStyle) =>
	asLine(`│ ${apply === undefined ? value : apply(value)}`);
export const emptyItem = (muted: TextStyle) => item("none", muted);
export const section = (title: string, border: TextStyle) =>
	asLine(border(`├─ ${title}`));
export const footer = (help: string, muted: TextStyle) =>
	asLine(muted(`╰─ ${help}`));

export const renderLines = (
	lines: readonly DashboardLine[],
	width: number,
	selected: TextStyle,
) =>
	lines.map((line) => {
		const fitted = fit(line.text, width);
		return line.selected ? selected(fitted) : fitted;
	});

export const maxScroll = (items: readonly unknown[], viewportRows: number) =>
	Math.max(0, items.length - Math.max(1, viewportRows));

export type PlotView = Component;
