/** Issue shape returned by tracker plugin methods. */
export interface IssueLike {
	readonly id: string;
	readonly identifier: string;
	readonly title: string;
	readonly description: string | null;
	readonly priority?: number;
	readonly state: string;
	readonly branchName?: string;
	readonly url: string | null;
	readonly labels: readonly string[];
	readonly blockedBy?: readonly {
		readonly id: string | null;
		readonly identifier: string | null;
		readonly state: string | null;
	}[];
	readonly autoMerge?: boolean;
	readonly metadata?: Record<string, unknown>;
	/** ISO-8601 date string or null. */
	readonly createdAt: string | null;
	/** ISO-8601 date string or null. */
	readonly updatedAt: string | null;
}

/** Minimal issue state entry returned by fetchIssueStatesByIds. */
export interface IssueStateEntryLike {
	readonly id: string;
	readonly state: string;
}

/** Run context returned by fetchRunContext — provides the workpad and review feedback. */
export interface TrackerRunContextLike {
	readonly raw: string | null;
	readonly promptContext: string | null;
	readonly workpad: string | null;
	readonly reviewFeedback: string | null;
	readonly workpadSections: ReadonlyArray<{
		readonly title: string;
		readonly body: string;
		readonly itemCount: number;
	}>;
}

/** Raw tracker config from the WORKFLOW.md frontmatter. */
export interface TrackerPluginConfig {
	readonly kind: string;
	readonly endpoint?: string;
	readonly apiKey?: string;
	readonly projectSlug?: string;
	readonly dispatchStates?: ReadonlyArray<string>;
	readonly parkedStates?: ReadonlyArray<string>;
	readonly terminalStates?: ReadonlyArray<string>;
	readonly [key: string]: unknown;
}

/** Client interface a tracker plugin must implement. */
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

/** Default export shape for a tracker plugin file. */
export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => PlainTrackerClient | Promise<PlainTrackerClient>;
}
