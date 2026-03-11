import { Context, Effect, Schema, type Layer } from "effect";
import type { Issue, IssueStateEntry } from "./issue.js";
import type { TrackerError } from "../errors.js";

export class WorkpadSection extends Schema.Class<WorkpadSection>(
	"WorkpadSection",
)({
	title: Schema.String,
	body: Schema.String,
	itemCount: Schema.Number,
}) {}

export class TrackerRunContext extends Schema.Class<TrackerRunContext>(
	"TrackerRunContext",
)({
	raw: Schema.NullOr(Schema.String),
	promptContext: Schema.NullOr(Schema.String),
	workpad: Schema.NullOr(Schema.String),
	reviewFeedback: Schema.NullOr(Schema.String),
	workpadSections: Schema.Array(WorkpadSection),
}) {}

export interface TrackerClientShape {
	readonly fetchCandidateIssues: (
		dispatchStates: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssuesByStates: (
		states: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<Issue>, TrackerError>;

	readonly fetchIssueStatesByIds: (
		ids: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<IssueStateEntry>, TrackerError>;

	readonly fetchRunContext: (
		issueId: string,
		state: string,
	) => Effect.Effect<TrackerRunContext | null, TrackerError>;
}

export class TrackerClient extends Context.Tag("TrackerClient")<
	TrackerClient,
	TrackerClientShape
>() {}

/**
 * Bag of tracker-specific configuration extracted from the workflow file's
 * `tracker` block. The plugin decides what keys it needs and validates
 * them internally.
 */
export interface TrackerPluginConfig {
	readonly kind: string;
	readonly endpoint?: string;
	readonly apiKey?: string;
	readonly projectSlug?: string;
	readonly dispatchStates?: ReadonlyArray<string>;
	readonly parkedStates?: ReadonlyArray<string>;
	readonly terminalStates?: ReadonlyArray<string>;
	/** Catch-all for tracker-specific keys the workflow YAML may contain. */
	readonly [key: string]: unknown;
}

/**
 * Contract implemented by tracker plugins.
 *
 * A tracker plugin is an npm package or local module that exports a default
 * `TrackerPlugin`. plot resolves the plugin at startup via dynamic `import()`
 * and calls `factory(config)` to obtain a `Layer<TrackerClient>`.
 *
 * Built-in trackers (e.g. `"github"`) are resolved by name; external ones
 * use npm package specifiers (`"@myorg/plot-tracker-jira"`) or relative
 * paths (`"./trackers/jira.ts"`).
 */
export interface TrackerPlugin {
	readonly name: string;
	readonly factory: (config: TrackerPluginConfig) => Layer.Layer<TrackerClient>;
	readonly skillPaths?: ReadonlyArray<string>;
}
