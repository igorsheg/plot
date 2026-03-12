import {
	buildRunContext,
	parseWorkpadSectionsPlain,
	TrackerRunContext,
	WorkpadSection,
} from "@plot/sdk";

export function parseWorkpadSections(
	workpad: string | null,
): ReadonlyArray<WorkpadSection> {
	return parseWorkpadSectionsPlain(workpad).map(
		(section: { title: string; body: string; itemCount: number }) =>
			new WorkpadSection(section),
	);
}

export function buildTrackerRunContext(input: {
	workpad: string | null;
	reviewFeedback?: string | null;
}): TrackerRunContext | null {
	const plain = buildRunContext(input);
	if (plain == null) return null;
	return new TrackerRunContext({
		raw: plain.raw ?? null,
		promptContext: plain.promptContext ?? null,
		workpad: plain.workpad ?? null,
		reviewFeedback: plain.reviewFeedback ?? null,
		workpadSections: (plain.workpadSections ?? []).map(
			(section: { title: string; body: string; itemCount: number }) =>
			new WorkpadSection(section),
		),
	});
}
