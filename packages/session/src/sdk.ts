export type MaybePromise<A> = A | Promise<A>;

export interface PlotToolTextContent {
	readonly type: "text";
	readonly text: string;
}

export interface PlotToolResult<Details = unknown> {
	readonly content: readonly PlotToolTextContent[];
	readonly details?: Details;
	readonly terminate?: boolean;
}

export interface PlotToolExecutionContext {
	readonly signal?: AbortSignal;
}

export type PlotToolExecutionMode = "sequential" | "parallel";

export type PlotJsonSchema =
	| { readonly type: "string"; readonly enum?: readonly string[] }
	| { readonly type: "number" }
	| { readonly type: "integer" }
	| { readonly type: "boolean" }
	| {
			readonly type: "array";
			readonly items?: PlotJsonSchema;
	  }
	| {
			readonly type: "object";
			readonly properties?: Readonly<Record<string, PlotJsonSchema>>;
			readonly required?: readonly string[];
	  };

export interface PlotToolDefinition<
	Params = Record<string, unknown>,
	Details = unknown,
> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly promptSnippet?: string;
	readonly promptGuidelines?: readonly string[];
	readonly parameters: PlotJsonSchema;
	readonly executionMode?: PlotToolExecutionMode;
	readonly execute: (
		params: Params,
		context: PlotToolExecutionContext,
	) => MaybePromise<PlotToolResult<Details>>;
}

export const defineTool = <T extends PlotToolDefinition>(tool: T): T => tool;

export interface WorkDisplay {
	readonly kind?: string;
	readonly primary?: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly version?: string;
	readonly labels?: readonly string[];
}

export interface OperatorActionConfirm {
	readonly title: string;
	readonly message?: string;
}

export interface OperatorAction {
	readonly id: string;
	readonly label: string;
	readonly tone?: "primary" | "secondary" | "danger";
	readonly disabledReason?: string;
	readonly requiresComment?: boolean;
	readonly confirm?: OperatorActionConfirm;
}

export type PlotExtensionWorkStatus =
	| "pending"
	| "waiting"
	| "blocked"
	| "cancelled";

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
	/**
	 * Source-visible scheduling state. Defaults to pending.
	 *
	 * Waiting and blocked work keep their claim and stay visible, but are not
	 * dispatched and running attempts are not interrupted. Waiting means the
	 * world must move; blocked means a human should act. Cancelled work is
	 * interrupted and released immediately. Omitting the work from discovery drains it: an active
	 * run finishes its current turn without continuation, then the claim is
	 * released without redispatch.
	 */
	readonly status?: PlotExtensionWorkStatus;
	/** Why held work is waiting or blocked. */
	readonly blockedReason?: string;
	/**
	 * Absolute per-work workspace directory. Plot creates the directory before
	 * the Agent Run starts and uses it as the run's working directory.
	 */
	readonly workspace?: string;
	/** Optional generic display hints. The TUI owns rendering; hints have no scheduling semantics. */
	readonly display?: WorkDisplay;
	/** Source-declared choices a human controller may perform on this work item. */
	readonly operatorActions?: readonly OperatorAction[];
	/** Domain context supplied to the inner agent alongside WORKFLOW.md prompt. */
	readonly context?: unknown;
}

export interface PlotToolContext<Config = unknown> {
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
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}

export type PlotExtensionTool<Config = unknown> =
	| PlotToolDefinition
	| ((context: PlotToolContext<Config>) => MaybePromise<PlotToolDefinition>);

export interface PlotExtensionSetupContext<Config = unknown> {
	readonly workflow: unknown;
	readonly paths: PlotToolContext<Config>["paths"];
	readonly config: Config;
	readonly work: (input: PlotExtensionWork) => PlotExtensionWork;
	readonly registerTool: (tool: PlotExtensionTool<Config>) => void;
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

export interface PlotExtensionOperatorActionEvent extends PlotExtensionWorkEvent {
	readonly actionId: string;
	readonly actionLabel: string;
	readonly timestamp: string;
	readonly comment?: string;
	readonly actor?: unknown;
	readonly clientId?: string;
}

export interface PlotExtensionRuntimeContext {
	readonly signal: AbortSignal;
}

/**
 * Signals that discovery could not observe the world (network failure, auth,
 * rate limit). Throwing from discover keeps the last-known Work Items and
 * retries next tick. Returning an empty array means the opposite: every
 * previously discovered Work Item is done or gone, so active runs drain and
 * claims are released. Never catch observation failures into an empty array.
 */
export class DiscoveryUnavailableError extends Error {
	override readonly name = "DiscoveryUnavailableError";
}

export interface PlotExtensionRuntime {
	/**
	 * Discover eligible domain work.
	 *
	 * Contract: returning an empty array means every Work Item is done or gone;
	 * active runs drain and claims are released. If observation itself fails,
	 * throw (see DiscoveryUnavailableError) so Plot keeps the last-known Work
	 * Items and retries next tick.
	 */
	readonly discover: (
		context?: PlotExtensionRuntimeContext,
	) => MaybePromise<readonly PlotExtensionWork[]>;
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
	/** Optional callback after Plot records a controller's Operator Action. */
	readonly operatorAction?: (
		event: PlotExtensionOperatorActionEvent,
	) => MaybePromise<void>;
	/** Optional callback after Plot times out a run. */
	readonly timedOut?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Optional process/session cleanup. */
	readonly shutdown?: (
		context?: PlotExtensionRuntimeContext,
	) => MaybePromise<void>;
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
