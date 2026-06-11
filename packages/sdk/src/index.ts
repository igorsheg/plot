export type MaybePromise<A> = A | Promise<A>;

export interface WorkDisplay {
	readonly kind?: string;
	readonly primary?: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly version?: string;
	readonly labels?: readonly string[];
}

export interface PlotExtensionWork {
	/** Stable domain identity, e.g. github:acme/web:pr:42 or jira:EPIC-123. */
	readonly id: string;
	/** Domain revision that should rerun work when it changes, e.g. PR head SHA. */
	readonly version?: string;
	/** Human-readable title for logs, UIs, and handoff surfaces. */
	readonly title?: string;
	/** Optional external URL for the source item. */
	readonly url?: string;
	/** Optional grouping key. Defaults to id when adapted into Plot internals. */
	readonly subject?: string;
	/** Optional generic display hints. TUI owns rendering; hints have no scheduling semantics. */
	readonly display?: WorkDisplay;
	/** Domain context supplied to the inner agent alongside WORKFLOW.md prompt. */
	readonly context?: unknown;
}

export interface PlotExtensionSetupContext<Config = unknown> {
	readonly workflow: unknown;
	readonly paths: {
		readonly cwd: string;
		readonly plotDir: string;
		readonly agentDir: string;
		readonly sessionDir: string;
		readonly skillsDir: string;
		readonly extensionsDir: string;
		readonly promptsDir: string;
	};
	readonly config: Config;
	readonly work: (input: PlotExtensionWork) => PlotExtensionWork;
}

export interface PlotExtensionWorkEvent {
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}

export interface PlotExtensionCompletedEvent extends PlotExtensionWorkEvent {
	readonly output?: unknown;
}

export interface PlotExtensionFailedEvent extends PlotExtensionWorkEvent {
	readonly error: unknown;
}

export interface PlotExtensionRuntime {
	/** Discover eligible domain work. No returned work means this tick is a no-op. */
	readonly discover: () => MaybePromise<readonly PlotExtensionWork[]>;
	/** Optional callback after Plot claims work and before the inner agent runs. */
	readonly started?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Optional callback after the inner agent finishes successfully. */
	readonly completed?: (
		event: PlotExtensionCompletedEvent,
	) => MaybePromise<void>;
	/** Optional callback after the inner agent fails. */
	readonly failed?: (event: PlotExtensionFailedEvent) => MaybePromise<void>;
	/** Optional callback after Plot interrupts a run. */
	readonly interrupted?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Optional callback after Plot times out a run. */
	readonly timedOut?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Optional process/session cleanup. */
	readonly shutdown?: () => MaybePromise<void>;
}

export interface PlotExtension<Config = unknown> {
	readonly id: string;
	readonly parseConfig?: (input: unknown) => MaybePromise<Config>;
	readonly create: (
		context: PlotExtensionSetupContext<Config>,
	) => MaybePromise<PlotExtensionRuntime>;
}

export const definePlotExtension = <Config>(
	extension: PlotExtension<Config>,
): PlotExtension<Config> => extension;
