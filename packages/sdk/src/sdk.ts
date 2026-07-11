/**
 * Public authoring surface for Plot extensions.
 *
 * This module is the authoritative API reference. The published package ships
 * it as `plot-ai/lib/sdk.d.ts`, and `plot docs sdk` prints it verbatim.
 * Semantics that types cannot express — scheduling outcomes, versioning,
 * retry — live in `plot docs extensions`.
 *
 * An extension is trusted TypeScript: it runs with the user's process
 * permissions and is not sandboxed. Import only from `plot-ai/sdk`; Plot
 * internals are not part of this contract.
 */
import type { OperatorAction, WorkDisplay } from "./work-contract.js";

export type {
	OperatorAction,
	OperatorActionConfirm,
	WorkDisplay,
} from "./work-contract.js";

export type MaybePromise<A> = A | Promise<A>;

/** One operator-visible text block in a tool result. */
export interface PlotToolTextContent {
	readonly type: "text";
	readonly text: string;
}

export interface PlotToolResult<Details = unknown> {
	/** Text returned to the agent and shown on operator surfaces. */
	readonly content: readonly PlotToolTextContent[];
	/** Optional structured payload recorded alongside the text content. */
	readonly details?: Details;
	/**
	 * When true, asks the Agent Session to stop after this call. Use for
	 * explicit finish tools; Plot still records the run's completion normally.
	 */
	readonly terminate?: boolean;
}

export interface PlotToolExecutionContext {
	/**
	 * Aborted on interruption, timeout, and shutdown. Pass it to network and
	 * subprocess calls so cancelled runs stop doing I/O.
	 */
	readonly signal?: AbortSignal;
}

/**
 * `sequential` tools are serialized with other tool calls; `parallel` tools
 * may run concurrently within one agent turn.
 */
export type PlotToolExecutionMode = "sequential" | "parallel";

/**
 * Supported JSON-schema subset for tool parameters.
 *
 * Before `execute` runs, Plot normalizes arguments against this schema:
 * only declared object properties are passed through (recursively for nested
 * objects and typed arrays); undeclared keys are dropped. Values are not
 * type-coerced — validate types inside `execute`.
 */
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

/**
 * A safe integration capability exposed to the Agent Session.
 *
 * Tools should expose what the integration can do, not script the agent's
 * reasoning step by step. Keep mutations idempotent and re-check domain
 * identity/version before writing, because a stale run may still call a tool
 * after the world has moved on.
 */
export interface PlotToolDefinition<
	Params = Record<string, unknown>,
	Details = unknown,
> {
	/**
	 * Stable machine name the agent calls, e.g. `post_review`. Names must be
	 * unique within one extension; duplicates fail at load time.
	 */
	readonly name: string;
	/** Short human-readable activity label for dashboards. */
	readonly label: string;
	/** What the tool does and when the agent should use it. */
	readonly description: string;
	/** Optional concise tool-specific text added to the agent prompt. */
	readonly promptSnippet?: string;
	/** Optional additional usage rules added to the agent prompt. */
	readonly promptGuidelines?: readonly string[];
	/** Parameter schema; see {@link PlotJsonSchema} for normalization rules. */
	readonly parameters: PlotJsonSchema;
	readonly executionMode?: PlotToolExecutionMode;
	/** Implementation. Receives normalized params and an abort signal. */
	readonly execute: (
		params: Params,
		context: PlotToolExecutionContext,
	) => MaybePromise<PlotToolResult<Details>>;
}

/** Identity helper that preserves the tool's inferred type. */
export const defineTool = <T extends PlotToolDefinition>(tool: T): T => tool;

/**
 * Source-owned scheduling state for a discovered Work Item.
 *
 * - `pending`: eligible for dispatch (the default).
 * - `waiting`: claimed but not dispatchable; the external world must change.
 * - `blocked`: claimed but not dispatchable; a human must decide (pair with
 *   `blockedReason` and `operatorActions`).
 * - `cancelled`: interrupt any active Agent Run and release the claim now.
 *
 * There is no `done` status: work that is finished or gone is simply omitted
 * from the next discovery result. An active run for omitted work drains — it
 * finishes its current turn, receives no continuation, and releases its claim
 * without redispatch.
 */
export type PlotExtensionWorkStatus =
	| "pending"
	| "waiting"
	| "blocked"
	| "cancelled";

/**
 * One unit of discovered domain work.
 *
 * Plot's internal work key is the extension `id` plus the Work Item `id` and
 * `version`. Two items in one discovery result must not share a key.
 */
export interface PlotExtensionWork {
	/**
	 * Stable domain identity, e.g. `github:acme/web:pr:42`. Never derive ids
	 * from timestamps or randomness — an id that changes between discoveries
	 * is a different Work Item.
	 */
	readonly id: string;
	/**
	 * Domain revision that should rerun work when it changes, e.g. a PR head
	 * SHA, update token, or CI attempt. A changed version supersedes the old
	 * one: an active run for the old version drains and the new version is
	 * dispatched fresh. Omit only when identity alone is sufficient.
	 */
	readonly version?: string;
	/** Human-readable title for logs, UIs, and handoff surfaces. */
	readonly title?: string;
	/** Optional external URL for the source item. */
	readonly url?: string;
	/**
	 * Optional grouping key that ties versions of the same domain item
	 * together. Defaults to `id`.
	 */
	readonly subject?: string;
	/** Scheduling state; see {@link PlotExtensionWorkStatus}. Default: `pending`. */
	readonly status?: PlotExtensionWorkStatus;
	/** Why held work is `waiting` or `blocked`, shown to operators. */
	readonly blockedReason?: string;
	/**
	 * Absolute per-work directory. Plot creates it before the Agent Run
	 * starts and uses it as the run's working directory. Give concurrent
	 * file-mutating work isolated workspaces.
	 */
	readonly workspace?: string;
	/** Presentation hints only; no scheduling semantics. */
	readonly display?: WorkDisplay;
	/** Choices a human operator may take on this item; see {@link OperatorAction}. */
	readonly operatorActions?: readonly OperatorAction[];
	/**
	 * Compact domain facts for the Workflow prompt template. An object is
	 * merged into the template's top level; any other value is available as
	 * `value`. Keep it small and factual — load large payloads through tools,
	 * and put investigation strategy in the Workflow prompt, not here.
	 */
	readonly context?: unknown;
}

/**
 * Binding context passed to tool factories, resolved once per Agent Run.
 */
export interface PlotToolContext<Config = unknown> {
	/** Parsed Workflow definition. */
	readonly workflow: unknown;
	/** Resolved project and session directories. */
	readonly paths: {
		readonly cwd: string;
		readonly plotDir: string;
		readonly agentDir: string;
		readonly sessionDir: string;
		readonly skillsDir: string;
		readonly extensionsDir: string;
		readonly promptsDir: string;
	};
	/** Extension config after `parseConfig`. */
	readonly config: Config;
	/** The Work Item selected for this Agent Run. */
	readonly work: PlotExtensionWork;
	/** The Agent Run id, when the tool is bound to a run. */
	readonly runId?: string;
}

/**
 * A static tool definition, or a factory that binds a tool to the selected
 * Work Item and Agent Run. Prefer a factory whenever a mutation must be
 * scoped to one item — closing over `work` lets `execute` re-check identity
 * and version before writing.
 */
export type PlotExtensionTool<Config = unknown> =
	| PlotToolDefinition
	| ((context: PlotToolContext<Config>) => MaybePromise<PlotToolDefinition>);

/** Context passed to {@link PlotExtension.create}, once per Plot Session. */
export interface PlotExtensionSetupContext<Config = unknown> {
	/** Parsed Workflow definition. */
	readonly workflow: unknown;
	readonly paths: PlotToolContext<Config>["paths"];
	/** Extension config after `parseConfig`. */
	readonly config: Config;
	/** Typed identity helper for building Work Items. */
	readonly work: (input: PlotExtensionWork) => PlotExtensionWork;
	/** Register a tool or per-run tool factory; see {@link PlotExtensionTool}. */
	readonly registerTool: (tool: PlotExtensionTool<Config>) => void;
}

export interface PlotExtensionWorkEvent {
	readonly work: PlotExtensionWork;
	readonly runId?: string;
}

export interface PlotExtensionCompletedEvent extends PlotExtensionWorkEvent {
	/** Final agent output, when the provider reports one. */
	readonly output?: unknown;
}

export interface PlotExtensionFailedEvent extends PlotExtensionWorkEvent {
	readonly error: unknown;
}

/**
 * A recorded human decision on a Work Item. The hook is bookkeeping — a later
 * `discover` remains the authority on what the decision means for the work.
 */
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

/**
 * The per-session runtime returned by {@link PlotExtension.create}.
 *
 * Plot owns scheduling around this runtime: it polls `discover` once per
 * tick, claims and dispatches eligible work, drains superseded or absent
 * work, and redispatches failed or timed-out runs with exponential backoff
 * (reset by success, interruption, disappearance, or a new version). Hooks
 * are bookkeeping around that Plot-owned lifecycle — do not launch agents or
 * implement a second scheduler from them.
 */
export interface PlotExtensionRuntime {
	/**
	 * Observe the domain and return every currently-relevant Work Item.
	 *
	 * Contract: returning an empty array means every Work Item is done or
	 * gone; active runs drain and claims are released. If observation itself
	 * fails, throw (see {@link DiscoveryUnavailableError}) so Plot keeps the
	 * last-known Work Items and retries next tick. Duplicate work identities
	 * in one result are rejected.
	 */
	readonly discover: (
		context?: PlotExtensionRuntimeContext,
	) => MaybePromise<readonly PlotExtensionWork[]>;
	/** Called after Plot claims work, before the Agent Run starts. */
	readonly started?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Called after an Agent Run finishes successfully. */
	readonly completed?: (
		event: PlotExtensionCompletedEvent,
	) => MaybePromise<void>;
	/** Called after an Agent Run fails. */
	readonly failed?: (event: PlotExtensionFailedEvent) => MaybePromise<void>;
	/** Called after Plot interrupts an Agent Run. */
	readonly interrupted?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/** Called after a human takes an Operator Action on this Source's work. */
	readonly operatorAction?: (
		event: PlotExtensionOperatorActionEvent,
	) => MaybePromise<void>;
	/** Called after Plot times out an Agent Run. */
	readonly timedOut?: (event: PlotExtensionWorkEvent) => MaybePromise<void>;
	/**
	 * Runs once at session end, after active runs receive interruption
	 * bookkeeping. Cleanup is protected even when other hooks fail.
	 */
	readonly shutdown?: (
		context?: PlotExtensionRuntimeContext,
	) => MaybePromise<void>;
}

/**
 * A Plot extension module exports this as `default` or as named export
 * `extension`.
 */
export interface PlotExtension<Config = unknown> {
	/**
	 * Stable Source id, part of every work key. Keep it constant across
	 * sessions and versions of the extension.
	 */
	readonly id: string;
	/**
	 * Optional boundary validator for the Workflow's `extension.config`
	 * value. Throw on invalid input; the parsed result is what `create` and
	 * tool factories receive.
	 */
	readonly parseConfig?: (input: unknown) => MaybePromise<Config>;
	/**
	 * Setup, run once per Plot Session. Register tools, build clients, then
	 * return the runtime. Do not start Agent Sessions or schedulers here.
	 */
	readonly create: (
		context: PlotExtensionSetupContext<Config>,
	) => MaybePromise<PlotExtensionRuntime>;
}

/** Identity helper that preserves the extension's config type. */
export const definePlotExtension = <Config>(
	extension: PlotExtension<Config>,
): PlotExtension<Config> => extension;
