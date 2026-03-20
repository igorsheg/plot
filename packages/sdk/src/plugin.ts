import type { Issue, IssueStateEntry } from "./schemas/issue.js";
import type { TrackerRunContext } from "./schemas/tracker.js";
import type { TrackerPluginConfig } from "./schemas/tracker.js";

export class PluginAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PluginAuthError";
	}
}

export class PluginRateLimitError extends Error {
	readonly retryAfterMs?: number;
	constructor(message: string, retryAfterMs?: number) {
		super(message);
		this.name = "PluginRateLimitError";
		this.retryAfterMs = retryAfterMs;
	}
}

export class PluginNotFoundError extends Error {
	readonly resourceId: string;
	constructor(message: string, resourceId: string) {
		super(message);
		this.name = "PluginNotFoundError";
		this.resourceId = resourceId;
	}
}

export class PluginValidationError extends Error {
	readonly field?: string;
	constructor(message: string, field?: string) {
		super(message);
		this.name = "PluginValidationError";
		this.field = field;
	}
}

export type IssueLike = typeof Issue.Encoded;

export type IssueStateEntryLike = typeof IssueStateEntry.Encoded;

export type TrackerRunContextLike = typeof TrackerRunContext.Encoded;

export interface PlainTrackerClient {
	readonly fetchCandidateIssues: (
		dispatchStates: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<IssueLike>>;
	readonly fetchIssuesByStates?: (
		states: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<IssueLike>>;
	readonly fetchIssueStatesByIds?: (
		ids: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<IssueStateEntryLike>>;
	readonly fetchRunContext?: (
		issueId: string,
		state: string,
	) => Promise<TrackerRunContextLike | null>;
	readonly updateIssue?: (options: {
		readonly issueId: string;
		readonly title?: string;
		readonly description?: string;
		readonly state?: string;
		readonly blockedBy?: ReadonlyArray<string>;
		readonly autoMerge?: boolean;
	}) => Promise<void>;
	readonly cancelIssue?: (issueId: string) => Promise<void>;
	readonly ensureInProgress?: (issueId: string) => Promise<void>;
	readonly issueAgentPreset?: (
		issue: IssueLike,
	) => Promise<{
		id: string;
		labels: ReadonlyArray<string>;
		model?: string;
		commandPrefix?: ReadonlyArray<string>;
		extraArgs?: ReadonlyArray<string>;
		metadata?: Record<string, unknown>;
	} | null>;
	readonly updateAgentPreset?: (preset: {
		readonly id: string;
		readonly labels: ReadonlyArray<string>;
		readonly model?: string;
		readonly commandPrefix?: ReadonlyArray<string>;
		readonly extraArgs?: ReadonlyArray<string>;
		readonly metadata?: Record<string, unknown>;
	}) => Promise<{
		id: string;
		labels: ReadonlyArray<string>;
		model?: string;
		commandPrefix?: ReadonlyArray<string>;
		extraArgs?: ReadonlyArray<string>;
		metadata?: Record<string, unknown>;
	}>;
	readonly agentPresetInfo?: (preset: {
		readonly id: string;
		readonly labels: ReadonlyArray<string>;
	}) => Promise<void>;
	readonly reset?: () => Promise<void>;
	readonly settings?: (projectId: string) => Promise<void>;
}

export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerClient | Promise<PlainTrackerClient>;
}

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
}): TrackerRunContextLike | null {
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
