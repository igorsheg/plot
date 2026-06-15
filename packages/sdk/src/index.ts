import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type {
	AgentToolResult,
	AgentToolUpdateCallback,
	ToolDefinition,
	ToolExecutionMode,
} from "@earendil-works/pi-coding-agent";
export { defineTool } from "@earendil-works/pi-coding-agent";

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
	 * Hold this work without releasing it. Blocked work keeps its claim and
	 * stays visible, but is not dispatched and running attempts are not
	 * interrupted. Pass a string to record the reason (e.g. "waiting for
	 * author reply"). Omitting the work from discover entirely means the
	 * opposite: the work is released and running attempts are stopped.
	 */
	readonly blocked?: boolean | string;
	/** Optional generic display hints. TUI/web own rendering; hints have no scheduling semantics. */
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
	| ToolDefinition
	| ((context: PlotToolContext<Config>) => MaybePromise<ToolDefinition>);

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
	/** Optional callback after Plot records a controller's Operator Action. */
	readonly operatorAction?: (
		event: PlotExtensionOperatorActionEvent,
	) => MaybePromise<void>;
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
