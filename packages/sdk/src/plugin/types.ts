import type { Issue, IssueStateEntry } from "../schemas/issue.js";
import type { TrackerRunContext } from "../schemas/tracker.js";
import type { TrackerPluginConfig } from "../schemas/tracker.js";

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
}

export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerClient | Promise<PlainTrackerClient>;
}
