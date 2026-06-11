import {
	truncateToWidth,
	visibleWidth,
	type Component,
} from "./pi-tui/index.ts";
import { style } from "./style.js";

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

// The left rail (╭ │ ├ ╰) is one continuous frame; it always renders in the
// border color, independent of the content styling on the rest of the row.
const rail = (glyph: string) => style.border(glyph);

export const row = (parts: readonly string[]) =>
	asLine(`${rail("│")} ${parts.join(" ")}`);
export const item = (value: string, apply?: TextStyle) =>
	asLine(`${rail("│")} ${apply === undefined ? value : apply(value)}`);
export const emptyItem = (muted: TextStyle) => item("none", muted);
export const blank = () => asLine(rail("│"));
export const section = (title: string, apply: TextStyle = style.muted) =>
	asLine(`${rail("├─")} ${apply(title)}`);
export const footer = (help: string, apply: TextStyle = style.muted) =>
	asLine(`${rail("╰─")} ${apply(help)}`);

/** Left text, right text pinned to the right edge; left truncates first. */
export const spread = (
	left: string,
	right: string,
	width: number,
	selected = false,
): DashboardLine => {
	const content = Math.max(1, width - 2);
	const rightWidth = visibleWidth(right);
	const leftFitted = fit(left, Math.max(1, content - rightWidth - 1));
	const gap = Math.max(1, content - visibleWidth(leftFitted) - rightWidth);
	return asLine(
		`${rail("│")} ${leftFitted}${" ".repeat(gap)}${right}`,
		selected,
	);
};

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
