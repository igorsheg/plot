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

/**
 * Encoded issue data suitable for plugin consumption — derived from Issue.Encoded
 * to provide a serializable representation that plugin authors can work with
 * without depending on the full Effect Schema machinery.
 */
export type IssueLike = typeof Issue.Encoded;

/**
 * Encoded state entry data for tracking issue state changes — derived from IssueStateEntry.Encoded
 * to provide plugins a lightweight way to handle issue state transitions without
 * depending on the full schema infrastructure.
 */
export type IssueStateEntryLike = typeof IssueStateEntry.Encoded;

/**
 * Encoded run context containing workpad, review feedback, and parsed sections — derived from TrackerRunContext.Encoded
 * to allow plugins to access execution context data for agent runs while maintaining
 * serialization compatibility and schema independence.
 */
export type TrackerRunContextLike = typeof TrackerRunContext.Encoded;

/**
 * Plugin-facing tracker client interface using plain Promises instead of Effect — provides
 * a simpler API for plugin authors who don't need Effect's advanced error handling.
 * Only `fetchCandidateIssues` is required; all other methods are optional and allow
 * plugins to implement only the functionality they need.
 */
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
	readonly issueAgentPreset?: (issue: IssueLike) => Promise<{
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

/**
 * Plugin definition following the two-phase lifecycle: validateConfig → factory.
 * The validateConfig phase allows plugins to transform raw config into a typed form,
 * while the factory phase creates the client instance with the validated config.
 * This separation enables early validation and type safety.
 */
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

/**
 * Parse workpad sections from markdown text expecting ### headings format — extracts
 * titled sections with body content and checklist item counts for structured processing.
 * Handles the standard workpad format used in plot issue tracking.
 */
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

/** Normalize state strings for consistent comparison by removing whitespace and forcing lowercase. */
export const normalizeState = (s: string): string => s.trim().toLowerCase();

/**
 * Assemble TrackerRunContext from workpad and review feedback inputs — combines
 * raw text into a structured context object with parsed sections for agent consumption.
 * Returns null when no meaningful context can be extracted from the inputs.
 */
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
