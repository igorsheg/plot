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

export interface IssueLike {
	readonly id: string;
	readonly identifier: string;
	readonly title: string;
	readonly description?: string | null;
	readonly priority?: number;
	readonly state: string;
	readonly branchName?: string;
	readonly url?: string | null;
	readonly labels: ReadonlyArray<string>;
	readonly blockedBy?: ReadonlyArray<{
		readonly id?: string | null;
		readonly identifier?: string | null;
		readonly state?: string | null;
	}>;
	readonly metadata?: Record<string, unknown>;
	readonly createdAt?: Date | string | null;
	readonly updatedAt?: Date | string | null;
}

export interface IssueStateEntryLike {
	readonly id: string;
	readonly state: string;
}

export interface TrackerRunContextLike {
	readonly raw?: string | null;
	readonly promptContext?: string | null;
	readonly workpad?: string | null;
	readonly reviewFeedback?: string | null;
	readonly workpadSections?: ReadonlyArray<{
		readonly title: string;
		readonly body: string;
		readonly itemCount: number;
	}>;
}

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
}

export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly skillPaths?: ReadonlyArray<string>;
	readonly validateConfig?: (
		raw: TrackerPluginConfig,
	) => TConfig | Promise<TConfig>;
	readonly factory: (
		config: TConfig,
	) => PlainTrackerClient | Promise<PlainTrackerClient>;
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
	const sections: Array<{ title: string; body: string; itemCount: number }> =
		[];
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
