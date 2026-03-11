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
 * Summary of an agent run returned after the agent process exits.
 */
export interface AgentResult {
	readonly turnCount: number;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly lastMessage: string | null;
}

/**
 * Optional lifecycle hooks a tracker plugin can provide.
 *
 * The orchestrator calls these hooks at key points during issue dispatch and
 * agent execution. All hooks are **best-effort** — if a hook effect fails the
 * error is logged and swallowed so it never interrupts the core dispatch loop.
 *
 * Plugins return a `TrackerPluginHooks` from their `hooks` factory function.
 * When omitted, no hooks fire.
 */
export interface TrackerPluginHooks {
	/**
	 * Called immediately after an issue has been claimed and registered for
	 * dispatch, before the agent process starts.
	 *
	 * Receives the {@link Issue} that was dispatched. Typically used for
	 * tracker-side bookkeeping such as ensuring a workpad comment exists.
	 *
	 * Best-effort — failures are logged and swallowed.
	 */
	readonly onIssueDispatched: (
		issue: Issue,
	) => Effect.Effect<void, unknown>;

	/**
	 * Called after the agent process exits successfully for an issue.
	 *
	 * Receives the {@link Issue} and an {@link AgentResult} summarising the
	 * run (turn count, token usage, last message).
	 *
	 * Best-effort — failures are logged and swallowed.
	 */
	readonly onAgentComplete: (
		issue: Issue,
		result: AgentResult,
	) => Effect.Effect<void, unknown>;

	/**
	 * Called after the agent process exits with a failure for an issue.
	 *
	 * Receives the {@link Issue} and a stringified error describing the cause.
	 *
	 * Best-effort — failures are logged and swallowed.
	 */
	readonly onAgentFailed: (
		issue: Issue,
		error: string,
	) => Effect.Effect<void, unknown>;
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
