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

export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerClient | Promise<PlainTrackerClient>;
}
