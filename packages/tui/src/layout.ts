import {
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

function padRight(line: string, width: number): string {
	const diff = width - visibleWidth(line);
	return diff > 0 ? line + " ".repeat(diff) : line;
}

export class Lines implements Component {
	private lines: string[] = [];

	setLines(lines: string[]) {
		this.lines = lines;
	}

	invalidate() {}

	render(width: number): string[] {
		if (width <= 0) return [];
		const rendered: string[] = [];
		for (const line of this.lines) {
			const wrapped = wrapTextWithAnsi(line, width);
			if (wrapped.length === 0) {
				rendered.push(" ".repeat(width));
				continue;
			}
			for (const part of wrapped) {
				rendered.push(padRight(truncateToWidth(part, width), width));
			}
		}
		return rendered;
	}
}

export class Panel implements Component {
	constructor(
		private child: Component,
		private title: string,
		private options?: { active?: boolean },
	) {}

	invalidate() {
		this.child.invalidate();
	}

	render(width: number): string[] {
		if (width <= 2) return [];
		const innerWidth = width - 2;
		const marker = this.options?.active ? "●" : "○";
		const title = truncateToWidth(
			`${this.title} ${marker}`,
			Math.max(0, innerWidth - 2),
		);
		const topFill = Math.max(0, innerWidth - 2 - visibleWidth(title));
		const top = `┌─${title}${"─".repeat(topFill)}┐`;
		const divider = `├${"─".repeat(innerWidth)}┤`;
		const body = this.child
			.render(innerWidth)
			.map(
				(line) =>
					`│${padRight(truncateToWidth(line, innerWidth), innerWidth)}│`,
			);
		const lines = body.length > 0 ? body : [`│${" ".repeat(innerWidth)}│`];
		return [top, divider, ...lines];
	}
}

export type ColumnSpec =
	| { kind: "fixed"; width: number }
	| { kind: "flex"; weight?: number };

export class Columns implements Component {
	constructor(
		private children: Component[],
		private specs: ColumnSpec[],
		private gutter = 1,
	) {}

	invalidate() {
		for (const child of this.children) {
			child.invalidate();
		}
	}

	private resolveWidths(width: number): number[] {
		const count = this.children.length;
		if (count === 0) return [];
		const totalGutter = this.gutter * Math.max(0, count - 1);
		let remaining = Math.max(0, width - totalGutter);
		const widths = new Array<number>(count).fill(0);
		const minFlexWidth = 12;
		const flexIndexes: number[] = [];

		for (let i = 0; i < count; i++) {
			const spec = this.specs[i] ?? { kind: "flex", weight: 1 };
			if (spec.kind === "fixed") {
				const flexRemaining = this.specs
					.slice(i + 1, count)
					.filter((next) => (next ?? { kind: "flex" }).kind === "flex").length;
				const reserve = flexRemaining * minFlexWidth;
				const nextWidth = Math.max(
					0,
					Math.min(spec.width, Math.max(0, remaining - reserve)),
				);
				widths[i] = nextWidth;
				remaining -= nextWidth;
			} else {
				flexIndexes.push(i);
			}
		}

		const totalWeight = flexIndexes.reduce((sum, index) => {
			const spec = this.specs[index];
			return sum + (spec && spec.kind === "flex" ? (spec.weight ?? 1) : 1);
		}, 0);

		let consumed = 0;
		for (let i = 0; i < flexIndexes.length; i++) {
			const index = flexIndexes[i]!;
			const spec = this.specs[index];
			const weight = spec && spec.kind === "flex" ? (spec.weight ?? 1) : 1;
			const nextWidth =
				i === flexIndexes.length - 1
					? Math.max(0, remaining - consumed)
					: Math.max(0, Math.floor((remaining * weight) / totalWeight));
			widths[index] = nextWidth;
			consumed += nextWidth;
		}

		return widths;
	}

	render(width: number): string[] {
		const widths = this.resolveWidths(width);
		const rendered = this.children.map((child, index) =>
			child.render(widths[index] ?? 0),
		);
		const maxHeight = rendered.reduce(
			(max, lines) => Math.max(max, lines.length),
			0,
		);
		const out: string[] = [];
		for (let row = 0; row < maxHeight; row++) {
			const parts = rendered.map((lines, index) => {
				const line = lines[row] ?? "";
				return padRight(
					truncateToWidth(line, widths[index] ?? 0),
					widths[index] ?? 0,
				);
			});
			out.push(parts.join(" ".repeat(this.gutter)));
		}
		return out;
	}
}
