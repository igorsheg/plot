import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NextAction } from "./envelope.js";

interface TruncationResult<T> {
	items: T[];
	total: number;
	truncated: boolean;
	full_output?: string;
}

export function truncateForContext<T>(
	items: T[],
	options: { maxItems?: number; command: string },
): { result: TruncationResult<T>; nextActions: NextAction[] } {
	const max = options.maxItems ?? 50;
	if (items.length <= max) {
		return {
			result: { items, total: items.length, truncated: false },
			nextActions: [],
		};
	}

	const dir = mkdtempSync(join(tmpdir(), "plot-ai-"));
	const filePath = join(dir, "full-output.json");
	writeFileSync(filePath, JSON.stringify(items, null, 2));

	return {
		result: {
			items: items.slice(0, max),
			total: items.length,
			truncated: true,
			full_output: filePath,
		},
		nextActions: [
			{
				command: `cat ${filePath}`,
				description: "view full output",
			},
		],
	};
}
