import type { WorkSubjectModel } from "./dashboard-model.js";
import {
	asLine,
	blank,
	footer,
	item,
	type DashboardLine,
} from "./dashboard-render.js";
import { clampWorkViewport, denseWorkRowLine } from "./process-table-view.js";
import { style } from "./style.js";

export const subjectViewLines = (input: {
	readonly subject: WorkSubjectModel | undefined;
	readonly selectedIndex: number;
	readonly width: number;
	readonly maxRows: number;
	readonly nowMs?: number;
}): readonly DashboardLine[] => {
	if (input.subject === undefined) {
		return [
			asLine(`${style.border("╭─ ")}${style.brand("Subject")}`),
			item("  subject no longer active", style.muted),
			footer("esc back", style.muted),
		];
	}
	const nowMs = input.nowMs ?? Date.now();
	const rows = input.subject.work.map((row, index) =>
		denseWorkRowLine(row, index === input.selectedIndex, input.width, nowMs),
	);
	const fixedRows = 4; // brand + meta + blank + footer
	const visible = clampWorkViewport(
		rows,
		input.selectedIndex,
		Math.max(1, input.maxRows - fixedRows),
	);
	return [
		asLine(`${style.border("╭─ ")}${style.brand(input.subject.label)}`),
		item(`  ${input.subject.meta}`, style.muted),
		blank(),
		...visible,
		footer(
			"j/k select · enter details · esc back · d detach · q stop",
			style.muted,
		),
	];
};
