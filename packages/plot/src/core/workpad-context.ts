import {
	buildRunContext,
	TrackerRunContext,
	WorkpadSection,
} from "@plot/sdk";

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
			(section: { title: string; body: string; itemCount: number }) => new WorkpadSection(section),
		),
	});
}
