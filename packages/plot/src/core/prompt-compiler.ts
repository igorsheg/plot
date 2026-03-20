import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { Issue, PromptSection, PromptSnapshot, TrackerRunContext } from "@plot/sdk";
import {
	PromptSection as PromptSectionSchema,
	PromptSnapshot as PromptSnapshotSchema,
} from "@plot/sdk";
import { renderPrompt } from "./prompt-renderer.js";

const PLOT_CONTRACT = [
	"you are a coding agent operating inside plot, an issue-driven orchestrator.",
	"advance the assigned issue safely, keep work visible in the tracker workpad, and avoid unrelated scope.",
	"treat the tracker workpad as the durable task memory between runs.",
	"prefer small validated changes over broad exploration or speculative refactors.",
].join("\n");

const OUTPUT_CONTRACT = [
	"before finishing, report only:",
	"1. completed actions",
	"2. validation evidence",
	"3. blockers that prevented more progress",
	"4. workpad updates that now reflect the current state",
].join("\n");

function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function buildSection(
	id: string,
	title: string,
	kind: "system" | "user",
	content: string,
): PromptSection {
	const normalized = normalizeBlock(content);
	return new PromptSectionSchema({
		id,
		title,
		kind,
		content: normalized,
		charCount: normalized.length,
	});
}

function renderIssuePayload(issue: Issue): string {
	const lines = [`issue: ${issue.identifier}`, `title: ${issue.title}`, `state: ${issue.state}`];

	if (issue.labels.length > 0) {
		lines.push(`labels: ${issue.labels.join(", ")}`);
	}

	if (issue.description) {
		lines.push("", "description:", issue.description.trim());
	}

	return lines.join("\n");
}

function renderRetryContext(attempt: number | null): string {
	if (attempt === null) {
		return [
			"attempt: first run",
			"start fresh from the current repository state.",
			"read the codebase before editing and define a narrow verification plan before broad checks.",
		].join("\n");
	}

	return [
		`attempt: retry #${attempt}`,
		"resume from the existing workspace state.",
		"do not repeat already-completed investigation or validation unless new evidence requires it.",
		"focus on the smallest change that can unblock the issue from its current state.",
	].join("\n");
}

function renderWorkpadContext(runContext: TrackerRunContext | null): string {
	if (!runContext) return "no tracker workpad context available.";

	const sections = runContext.workpadSections.map((section) => {
		const itemSuffix = section.itemCount > 0 ? ` (${section.itemCount} checklist items)` : "";
		return `### ${section.title}${itemSuffix}\n\n${section.body}`.trim();
	});

	const blocks = [
		runContext.workpad ? `## Workpad\n\n${runContext.workpad}` : null,
		runContext.reviewFeedback ? `## Review Feedback\n\n${runContext.reviewFeedback}` : null,
		sections.length > 0 ? `## Parsed Workpad Sections\n\n${sections.join("\n\n")}` : null,
	].filter((value): value is string => Boolean(value));

	return blocks.join("\n\n");
}

function joinSections(sections: ReadonlyArray<PromptSection>): string {
	return sections
		.map((section) => `## ${section.title}\n\n${section.content}`.trim())
		.filter((section) => section.length > 0)
		.join("\n\n");
}

export interface CompiledPrompt {
	readonly systemPrompt: string;
	readonly userPrompt: string;
	readonly snapshot: PromptSnapshot;
}

export const compilePrompt = Effect.fnUntraced(function* (
	template: string,
	issue: Issue,
	attempt: number | null,
	runContext: TrackerRunContext | null,
) {
	const workflowPolicy = yield* renderPrompt(
		template,
		issue,
		attempt,
		runContext?.promptContext ?? null,
	);

	const systemSections = [
		buildSection("plot-contract", "plot operating contract", "system", PLOT_CONTRACT),
		buildSection("workflow-policy", "workflow policy", "system", workflowPolicy),
		buildSection("output-contract", "output contract", "system", OUTPUT_CONTRACT),
	];

	const userSections = [
		buildSection("issue-payload", "issue payload", "user", renderIssuePayload(issue)),
		buildSection(
			"tracker-context",
			"tracker workpad context",
			"user",
			renderWorkpadContext(runContext),
		),
		buildSection("retry-context", "retry context", "user", renderRetryContext(attempt)),
	];

	const systemPrompt = joinSections(systemSections);
	const userPrompt = joinSections(userSections);
	const stablePrefix = joinSections(systemSections.slice(0, 2));
	const stablePrefixHash = createHash("sha1").update(stablePrefix).digest("hex");

	return {
		systemPrompt,
		userPrompt,
		snapshot: new PromptSnapshotSchema({
			system: systemPrompt,
			user: userPrompt,
			stablePrefix,
			stablePrefixHash,
			systemCharCount: systemPrompt.length,
			userCharCount: userPrompt.length,
			systemSections,
			userSections,
		}),
	} satisfies CompiledPrompt;
});
