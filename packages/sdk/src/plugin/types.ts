/** Issue shape returned by tracker plugin methods. */
export interface TrackerIssue {
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
export interface TrackerIssueState {
	readonly id: string;
	readonly state: string;
}

/** Raw run context returned by plugin fetchRunContext — the orchestrator parses sections. */
export interface TrackerRunContextRaw {
	readonly workpad: string | null;
	readonly reviewFeedback?: string | null;
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
export interface TrackerPluginClient {
	readonly fetchCandidateIssues: (
		dispatchStates: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssue>>;
	readonly fetchIssuesByStates?: (
		states: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssue>>;
	readonly fetchIssueStatesByIds?: (
		ids: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssueState>>;
	readonly fetchRunContext?: (
		issueId: string,
		state: string,
	) => Promise<TrackerRunContextRaw | null>;
	readonly dispose?: () => void | Promise<void>;
}

/** Default export shape for a tracker plugin file. */
export interface TrackerPluginDefinition<TConfig = TrackerPluginConfig> {
	readonly name: string;
	readonly validateConfig?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly factory: (config: TConfig) => TrackerPluginClient | Promise<TrackerPluginClient>;
}

/** Context object passed to each method in a defineTracker definition. */
export interface TrackerContext<TConfig = TrackerPluginConfig> {
	readonly config: TConfig;
	readonly states: {
		readonly dispatch: ReadonlyArray<string>;
		readonly parked: ReadonlyArray<string>;
		readonly terminal: ReadonlyArray<string>;
	};
}

/** Shape passed to defineTracker — declarative tracker plugin definition. */
export interface TrackerDefinition<TConfig = TrackerPluginConfig, TSetup = unknown> {
	readonly name: string;
	readonly config?: (raw: TrackerPluginConfig) => TConfig | Promise<TConfig>;
	readonly setup?: (ctx: TrackerContext<TConfig>) => TSetup | Promise<TSetup>;
	readonly fetchCandidateIssues: (
		ctx: TrackerContext<TConfig> & TSetup,
		dispatchStates: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssue>>;
	readonly fetchIssuesByStates?: (
		ctx: TrackerContext<TConfig> & TSetup,
		states: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssue>>;
	readonly fetchIssueStatesByIds?: (
		ctx: TrackerContext<TConfig> & TSetup,
		ids: ReadonlyArray<string>,
	) => Promise<ReadonlyArray<TrackerIssueState>>;
	readonly fetchRunContext?: (
		ctx: TrackerContext<TConfig> & TSetup,
		issueId: string,
		state: string,
	) => Promise<TrackerRunContextRaw | null>;
	readonly dispose?: () => void | Promise<void>;
}

/** Factory for creating tracker plugins from a declarative definition. */
export function defineTracker<TConfig = TrackerPluginConfig, TSetup = unknown>(
	definition: TrackerDefinition<TConfig, TSetup>,
): TrackerPluginDefinition<TConfig> {
	return {
		name: definition.name,
		validateConfig: definition.config,
		async factory(config: TConfig) {
			const pluginConfig = config as TrackerPluginConfig & TConfig;
			const baseCtx: TrackerContext<TConfig> = {
				config,
				states: {
					dispatch: (pluginConfig as any).dispatchStates ?? (pluginConfig as any).dispatch_states ?? [],
					parked: (pluginConfig as any).parkedStates ?? (pluginConfig as any).parked_states ?? [],
					terminal: (pluginConfig as any).terminalStates ?? (pluginConfig as any).terminal_states ?? [],
				},
			};
			const setupResult = definition.setup ? await Promise.resolve(definition.setup(baseCtx)) : ({} as TSetup);
			const ctx = { ...baseCtx, ...setupResult } as TrackerContext<TConfig> & TSetup;
			return {
				fetchCandidateIssues: (dispatchStates) => definition.fetchCandidateIssues(ctx, dispatchStates),
				fetchIssuesByStates: definition.fetchIssuesByStates
					? (states) => definition.fetchIssuesByStates!(ctx, states)
					: undefined,
				fetchIssueStatesByIds: definition.fetchIssueStatesByIds
					? (ids) => definition.fetchIssueStatesByIds!(ctx, ids)
					: undefined,
				fetchRunContext: definition.fetchRunContext
					? (issueId, state) => definition.fetchRunContext!(ctx, issueId, state)
					: undefined,
				dispose: definition.dispose,
			};
		},
	};
}
