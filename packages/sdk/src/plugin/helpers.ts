function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function countChecklistItems(body: string): number {
	return (body.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? []).length;
}

export function parseWorkpadSectionsPlain(
	workpad: string | null,
): ReadonlyArray<{ title: string; body: string; itemCount: number }> {
	const source = normalizeBlock(workpad);
	if (!source) return [];

	const lines = source.split("\n");
	const sections: Array<{ title: string; body: string; itemCount: number }> = [];
	let currentTitle: string | null = null;
	let currentBody: string[] = [];

	const flush = () => {
		if (!currentTitle) return;
		const body = normalizeBlock(currentBody.join("\n"));
		sections.push({
			title: currentTitle,
			body,
			itemCount: countChecklistItems(body),
		});
	};

	for (const line of lines) {
		const heading = /^###\s+(.+?)\s*$/.exec(line);
		if (heading) {
			flush();
			currentTitle = heading[1]!.trim();
			currentBody = [];
			continue;
		}
		if (currentTitle) {
			currentBody.push(line);
		}
	}

	flush();
	return sections;
}

export const normalizeState = (s: string): string => s.trim().toLowerCase();

export function buildRunContext(input: {
	workpad: string | null;
	reviewFeedback?: string | null;
}): {
	raw: string | null;
	promptContext: string | null;
	workpad: string | null;
	reviewFeedback: string | null;
	workpadSections: ReadonlyArray<{ title: string; body: string; itemCount: number }>;
} | null {
	const workpad = normalizeBlock(input.workpad);
	const reviewFeedback = normalizeBlock(input.reviewFeedback);
	const sections = parseWorkpadSectionsPlain(workpad || null);
	const parts = [
		workpad ? "## Workpad\n\n" + workpad : null,
		reviewFeedback ? "## Review Feedback\n\n" + reviewFeedback : null,
	].filter((v): v is string => Boolean(v));

	if (parts.length === 0) return null;

	return {
		raw: parts.join("\n\n"),
		promptContext: parts.join("\n\n"),
		workpad: workpad || null,
		reviewFeedback: reviewFeedback || null,
		workpadSections: sections,
	};
}
