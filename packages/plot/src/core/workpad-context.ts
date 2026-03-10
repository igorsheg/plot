import { TrackerRunContext, WorkpadSection } from "@plot/sdk";

function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function countChecklistItems(body: string): number {
	return (body.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? []).length;
}

export function parseWorkpadSections(
	workpad: string | null,
): ReadonlyArray<WorkpadSection> {
	const source = normalizeBlock(workpad);
	if (!source) return [];

	const lines = source.split("\n");
	const sections: WorkpadSection[] = [];
	let currentTitle: string | null = null;
	let currentBody: string[] = [];

	const flush = () => {
		if (!currentTitle) return;
		const body = normalizeBlock(currentBody.join("\n"));
		sections.push(
			new WorkpadSection({
				title: currentTitle,
				body,
				itemCount: countChecklistItems(body),
			}),
		);
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

export function buildTrackerRunContext(input: {
	workpad: string | null;
	reviewFeedback?: string | null;
}): TrackerRunContext | null {
	const workpad = normalizeBlock(input.workpad);
	const reviewFeedback = normalizeBlock(input.reviewFeedback);
	const sections = parseWorkpadSections(workpad || null);
	const parts = [
		workpad ? "## Workpad\n\n" + workpad : null,
		reviewFeedback ? "## Review Feedback\n\n" + reviewFeedback : null,
	].filter((value): value is string => Boolean(value));

	if (parts.length === 0) return null;

	return new TrackerRunContext({
		raw: parts.join("\n\n"),
		promptContext: parts.join("\n\n"),
		workpad: workpad || null,
		reviewFeedback: reviewFeedback || null,
		workpadSections: [...sections],
	});
}
