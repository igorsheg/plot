import { DateTime, Effect, JSONSchema, Layer, Schema } from "effect";
import { BlockerRef, Issue, IssueStateEntry } from "./schemas/issue.js";
import {
	TrackerAuthError,
	TrackerNetworkError,
	TrackerNotFoundError,
	TrackerRateLimitError,
	TrackerValidationError,
	type TrackerError,
} from "./errors.js";
import {
	TrackerClient,
	TrackerRunContext,
	WorkpadSection,
	type TrackerPluginConfig,
} from "./schemas/tracker.js";

// ---------------------------------------------------------------------------
// Plain error classes — plugin authors throw these for granular error mapping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// JSON Schema subset
// ---------------------------------------------------------------------------

export interface JsonSchema {
	readonly type?: string;
	readonly properties?: Record<string, JsonSchema>;
	readonly required?: ReadonlyArray<string>;
	readonly additionalProperties?: boolean | JsonSchema;
	readonly items?: JsonSchema;
	readonly description?: string;
	readonly enum?: ReadonlyArray<unknown>;
	readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Plain issue-like types — what plugin authors return from tracker methods
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Plain plugin author-facing types
// ---------------------------------------------------------------------------

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

export type ToolParameterSchema = JsonSchema | Schema.Schema.Any;

export interface PlainPluginToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: ToolParameterSchema;
	readonly execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface PlainTrackerInstance {
	readonly tracker: PlainTrackerClient;
	readonly tools?: ReadonlyArray<PlainPluginToolDefinition>;
}

export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly skillPaths?: ReadonlyArray<string>;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerInstance | Promise<PlainTrackerInstance>;
}

// ---------------------------------------------------------------------------
// Normalized types — consumed by the plot runtime
// ---------------------------------------------------------------------------

export interface PluginToolDefinition {
	readonly name: string;
	readonly description: string;
	readonly parameters: JsonSchema;
	readonly execute: (args: unknown) => Effect.Effect<unknown, TrackerError>;
}

export interface TrackerPlugin {
	readonly name: string;
	readonly skillPaths?: ReadonlyArray<string>;
	readonly resolveConfig: (raw: TrackerPluginConfig) => Effect.Effect<unknown>;
	readonly buildInstance: (config: unknown) => Effect.Effect<ResolvedTrackerInstance>;
}

export interface ResolvedTrackerInstance {
	readonly trackerLayer: Layer.Layer<TrackerClient>;
	readonly tools: ReadonlyArray<PluginToolDefinition>;
}

// ---------------------------------------------------------------------------
// Plain workpad parsing utilities
// ---------------------------------------------------------------------------

function normalizeBlock(value: string | null | undefined): string {
	return (value ?? "").replace(/\r\n/g, "\n").trim();
}

function countChecklistItems(body: string): number {
	return (body.match(/^\s*[-*]\s+\[[ xX]\]/gm) ?? []).length;
}

export function parseWorkpadSections(
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

export function buildRunContext(input: {
	workpad: string | null;
	reviewFeedback?: string | null;
}): TrackerRunContextLike | null {
	const workpad = normalizeBlock(input.workpad);
	const reviewFeedback = normalizeBlock(input.reviewFeedback);
	const sections = parseWorkpadSections(workpad || null);
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

// ---------------------------------------------------------------------------
// Error mapping: plugin errors → Effect tracker errors
// ---------------------------------------------------------------------------

function mapPluginError(error: unknown, operation: string): TrackerError {
	if (error instanceof PluginAuthError) {
		return new TrackerAuthError({ message: error.message });
	}
	if (error instanceof PluginRateLimitError) {
		return new TrackerRateLimitError({
			message: error.message,
			retryAfterMs: error.retryAfterMs,
		});
	}
	if (error instanceof PluginNotFoundError) {
		return new TrackerNotFoundError({
			message: error.message,
			resourceId: error.resourceId,
		});
	}
	if (error instanceof PluginValidationError) {
		return new TrackerValidationError({
			message: error.message,
			field: error.field,
		});
	}
	const message = error instanceof Error ? error.message : String(error);
	return new TrackerNetworkError({ message: `${operation}: ${message}` });
}

// ---------------------------------------------------------------------------
// Normalizers: plain types → Effect/Schema types
// ---------------------------------------------------------------------------

function toDateTime(value: Date | string | null | undefined): DateTime.Utc | null {
	if (value == null) return null;
	const date = typeof value === "string" ? new Date(value) : value;
	return DateTime.unsafeFromDate(date);
}

function normalizeIssue(plain: IssueLike): Issue {
	return new Issue({
		id: plain.id,
		identifier: plain.identifier,
		title: plain.title,
		description: plain.description ?? null,
		priority: plain.priority,
		state: plain.state,
		branchName: plain.branchName,
		url: plain.url ?? null,
		labels: Array.from(plain.labels),
		blockedBy: plain.blockedBy?.map(
			(b) => new BlockerRef({ id: b.id ?? null, identifier: b.identifier ?? null, state: b.state ?? null }),
		),
		metadata: plain.metadata,
		createdAt: toDateTime(plain.createdAt),
		updatedAt: toDateTime(plain.updatedAt),
	});
}

function normalizeIssueStateEntry(plain: IssueStateEntryLike): IssueStateEntry {
	return new IssueStateEntry({ id: plain.id, state: plain.state });
}

function normalizeRunContext(plain: TrackerRunContextLike | null): TrackerRunContext | null {
	if (plain == null) return null;
	return new TrackerRunContext({
		raw: plain.raw ?? null,
		promptContext: plain.promptContext ?? null,
		workpad: plain.workpad ?? null,
		reviewFeedback: plain.reviewFeedback ?? null,
		workpadSections: (plain.workpadSections ?? []).map((s) => new WorkpadSection(s)),
	});
}

// ---------------------------------------------------------------------------
// Adapter: PlainTrackerClient → Layer<TrackerClient>
// ---------------------------------------------------------------------------

function adaptTrackerClient(plain: PlainTrackerClient): Layer.Layer<TrackerClient> {
	return Layer.succeed(
		TrackerClient,
		TrackerClient.of({
			fetchCandidateIssues: (dispatchStates) =>
				Effect.tryPromise({
					try: () => plain.fetchCandidateIssues(dispatchStates),
					catch: (e) => mapPluginError(e, "fetchCandidateIssues"),
				}).pipe(Effect.map((issues) => issues.map(normalizeIssue))),
			fetchIssuesByStates: (states) =>
				Effect.tryPromise({
					try: () => plain.fetchIssuesByStates?.(states) ?? Promise.resolve([]),
					catch: (e) => mapPluginError(e, "fetchIssuesByStates"),
				}).pipe(Effect.map((issues) => issues.map(normalizeIssue))),
			fetchIssueStatesByIds: (ids) =>
				Effect.tryPromise({
					try: () => plain.fetchIssueStatesByIds?.(ids) ?? Promise.resolve([]),
					catch: (e) => mapPluginError(e, "fetchIssueStatesByIds"),
				}).pipe(Effect.map((entries) => entries.map(normalizeIssueStateEntry))),
			fetchRunContext: (issueId, state) =>
				Effect.tryPromise({
					try: () => plain.fetchRunContext?.(issueId, state) ?? Promise.resolve(null),
					catch: (e) => mapPluginError(e, "fetchRunContext"),
				}).pipe(Effect.map(normalizeRunContext)),
		}),
	);
}

// ---------------------------------------------------------------------------
// Adapter: ToolParameterSchema → JsonSchema
// ---------------------------------------------------------------------------

function resolveToolParameters(schema: ToolParameterSchema): JsonSchema {
	if (Schema.isSchema(schema)) {
		return JSONSchema.make(schema) as unknown as JsonSchema;
	}
	return schema as JsonSchema;
}

// ---------------------------------------------------------------------------
// Adapter: PlainPluginToolDefinition → PluginToolDefinition
// ---------------------------------------------------------------------------

function adaptTool(tool: PlainPluginToolDefinition): PluginToolDefinition {
	return {
		name: tool.name,
		description: tool.description,
		parameters: resolveToolParameters(tool.parameters),
		execute: (args) =>
			Effect.tryPromise({
				try: () => tool.execute(args as Record<string, unknown>),
				catch: (e) => mapPluginError(e, `tool:${tool.name}`),
			}),
	};
}

// ---------------------------------------------------------------------------
// defineTrackerPlugin: main entry point for plugin authors
// ---------------------------------------------------------------------------

export function defineTrackerPlugin<TConfig = TrackerPluginConfig>(
	definition: TrackerPluginDefinition<TConfig>,
): TrackerPlugin {
	return {
		name: definition.name,
		skillPaths: definition.skillPaths,

		resolveConfig: (raw) => {
			if (!definition.validateConfig) {
				return Effect.succeed(raw as unknown);
			}
			return Effect.tryPromise({
				try: () => Promise.resolve(definition.validateConfig!(raw)),
				catch: (error) =>
					new Error(
						`Plugin "${definition.name}" config validation failed: ${error instanceof Error ? error.message : String(error)}`,
					),
			}).pipe(Effect.orDie);
		},

		buildInstance: (config) =>
			Effect.tryPromise({
				try: () => Promise.resolve(definition.factory(config as TConfig)),
				catch: (error) =>
					new Error(
						`Plugin "${definition.name}" factory failed: ${error instanceof Error ? error.message : String(error)}`,
					),
			}).pipe(
				Effect.orDie,
				Effect.map((instance) => ({
					trackerLayer: adaptTrackerClient(instance.tracker),
					tools: (instance.tools ?? []).map(adaptTool),
				})),
			),
	};
}
