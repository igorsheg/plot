import { Context, Effect, type Layer } from "effect";
import type { Issue, IssueStateEntry } from "./issue.js";
import type { TrackerError } from "../errors.js";

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
  ) => Effect.Effect<string | null, TrackerError>;
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
}
