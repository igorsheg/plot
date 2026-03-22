import type { Issue, IssueStateEntry } from "../schemas/issue.js";
import type { TrackerRunContext } from "../schemas/tracker.js";
import type { TrackerPluginConfig } from "../schemas/tracker.js";

/**
 * Represents an issue as encoded by the Effect Schema system, derived from Issue.Encoded.
 * This is the shape plugin authors must return from their tracker implementations
 * to ensure compatibility with the plot orchestrator's issue processing pipeline.
 */
export type IssueLike = typeof Issue.Encoded;

/**
 * Represents an issue state transition as encoded by the Effect Schema system.
 * Plugin authors use this when returning state change records to track issue progression
 * through workflow states within their external tracker systems.
 */
export type IssueStateEntryLike = typeof IssueStateEntry.Encoded;

/**
 * Represents the execution context for a specific issue and state combination.
 * This carries forward prompt context, workpad content, and review feedback between
 * orchestrator runs, enabling stateful plugin integrations and context preservation.
 */
export type TrackerRunContextLike = typeof TrackerRunContext.Encoded;

/**
 * Defines the contract tracker plugins must implement to provide issue data to plot.
 * fetchCandidateIssues is required as the primary method for discovering dispatchable work.
 * Optional methods enable richer integrations for state tracking and context retrieval,
 * allowing plugins to support advanced orchestration features when available.
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
}

/**
 * Defines the plugin architecture for tracker integrations, implementing a two-phase lifecycle.
 * validateConfig transforms raw configuration into validated plugin-specific settings,
 * then factory creates the actual client instance using that validated configuration.
 * This separation enables early validation and dependency injection patterns while 
 * preserving type safety across the plugin boundary.
 */
export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerClient | Promise<PlainTrackerClient>;
}
