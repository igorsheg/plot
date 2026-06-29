export interface ChangedLineRange {
	readonly start: number;
	end: number;
	readonly deletion?: true;
}

export interface DiffContextFile {
	readonly path: string;
	readonly changedLines: ChangedLineRange[];
}

export const parseDiffContext = (diff: string): DiffContextFile[] => {
	const files: DiffContextFile[] = [];
	let current: DiffContextFile | undefined;
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;
	const pushRange = (line: number, deletion?: true) => {
		if (current === undefined) return;
		const previous = current.changedLines.at(-1);
		if (
			previous !== undefined &&
			previous.deletion === deletion &&
			previous.end + 1 === line
		) {
			previous.end = line;
			return;
		}
		current.changedLines.push(
			deletion === true
				? { start: line, end: line, deletion }
				: { start: line, end: line },
		);
	};
	for (const line of diff.split("\n")) {
		const header = line.match(/^diff --git a\/.+ b\/(.+)$/);
		if (header?.[1] !== undefined) {
			current = { path: header[1], changedLines: [] };
			files.push(current);
			inHunk = false;
			continue;
		}
		if (current === undefined) continue;
		const hunk = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (hunk !== null) {
			oldLine = Number.parseInt(hunk[1] ?? "0", 10);
			newLine = Number.parseInt(hunk[3] ?? "0", 10);
			inHunk = true;
			continue;
		}
		if (!inHunk || line.startsWith("\\")) continue;
		if (line.startsWith("+")) {
			pushRange(newLine);
			newLine += 1;
			continue;
		}
		if (line.startsWith("-")) {
			pushRange(oldLine, true);
			oldLine += 1;
			continue;
		}
		oldLine += 1;
		newLine += 1;
	}
	return files;
};
