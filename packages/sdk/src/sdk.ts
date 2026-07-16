/**
 * Public authoring surface for extensions.
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
import type {
	AgentRunOutcome,
	OperatorAction,
	OperatorObservationInput,
	WorkDisplay,
	WorkStatus,
} from "./work-contract.js";

export type {
	AgentRunOutcome,
	OperatorAction,
	OperatorActionConfirm,
	OperatorActionInput,
	OperatorActionTone,
	OperatorObservationInput,
	WorkDisplay,
	WorkStatus,
} from "./work-contract.js";

export type MaybePromise<A> = A | Promise<A>;

export type ExtensionRequirementState =
	| { readonly status: "ready" }
	| {
			readonly status: "action-required";
			readonly message: string;
			readonly actions: readonly OperatorAction[];
	  }
	| {
			readonly status: "unavailable";
			readonly message: string;
			readonly retryAfterMs?: number;
	  };

export interface ExtensionCredentials {
	readonly get: (key: string) => Promise<unknown | undefined>;
	readonly set: (key: string, value: unknown) => Promise<void>;
	readonly delete: (key: string) => Promise<void>;
}

export interface ExtensionOAuthCallback {
	readonly redirectUri: string;
	readonly wait: (options?: {
		readonly signal?: AbortSignal;
	}) => Promise<string>;
}

export interface ExtensionInteraction {
	readonly openUrl: (
		url: string,
		options?: { readonly fallbackText?: string },
	) => MaybePromise<void>;
	readonly createOAuthCallback: (options?: {
		readonly timeoutMs?: number;
	}) => Promise<ExtensionOAuthCallback>;
	readonly reportProgress: (message: string) => MaybePromise<void>;
}

export interface ExtensionRuntimeContext {
	readonly signal: AbortSignal;
}

export interface ExtensionRequirementCheckContext extends ExtensionRuntimeContext {
	/** Aborted when the tick or Session stops. */
	readonly credentials: ExtensionCredentials;
}

export interface ExtensionRequirementActionContext extends ExtensionRequirementCheckContext {
	readonly actionId: string;
	readonly interaction: ExtensionInteraction;
}

/**
 * A cheap, local prerequisite checked before discovery. `check` must not
 * perform network I/O or launch interactive setup.
 */
export interface ExtensionRequirement {
	readonly id: string;
	readonly label: string;
	readonly check: (
		context: ExtensionRequirementCheckContext,
	) => MaybePromise<ExtensionRequirementState>;
	readonly action?: (
		context: ExtensionRequirementActionContext,
	) => MaybePromise<void>;
}

export interface ToolTextContent {
	readonly type: "text";
	readonly text: string;
}

export interface ToolResult<Details = unknown> {
	readonly content: readonly ToolTextContent[];
	readonly details?: Details;
	/**
	 * When true, asks the Agent Session to stop after this call. Use for
	 * explicit finish tools; Plot still records the run's completion normally.
	 */
	readonly terminate?: boolean;
}

export interface ToolExecutionContext {
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
export type ToolExecutionMode = "sequential" | "parallel";

/**
 * Supported JSON-schema subset for tool parameters.
 *
 * Before `execute` runs, Plot normalizes arguments against this schema:
 * only declared object properties are passed through (recursively for nested
 * objects and typed arrays); undeclared keys are dropped. Values are not
 * type-coerced — validate types inside `execute`.
 */
export type JsonSchema =
	| { readonly type: "string"; readonly enum?: readonly string[] }
	| { readonly type: "number" }
	| { readonly type: "integer" }
	| { readonly type: "boolean" }
	| {
			readonly type: "array";
			readonly items?: JsonSchema;
	  }
	| {
			readonly type: "object";
			readonly properties?: Readonly<Record<string, JsonSchema>>;
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
export interface ToolDefinition<
	Params = Record<string, unknown>,
	Details = unknown,
> {
	/**
	 * Stable machine name the agent calls, e.g. `post_review`. Names must be
	 * unique within one extension; duplicates fail at load time.
	 */
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly promptSnippet?: string;
	readonly promptGuidelines?: readonly string[];
	readonly parameters: JsonSchema;
	readonly executionMode?: ToolExecutionMode;
	readonly execute: (
		params: Params,
		context: ToolExecutionContext,
	) => MaybePromise<ToolResult<Details>>;
}

export const defineTool = <T extends ToolDefinition>(tool: T): T => tool;

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
export type ExtensionWorkStatus = Extract<
	WorkStatus,
	"pending" | "waiting" | "blocked" | "cancelled"
>;

/**
 * One unit of discovered domain work.
 *
 * Plot's internal work key is the extension `id` plus the Work Item `id` and
 * `version`. Two items in one discovery result must not share a key.
 */
export interface ExtensionWork {
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
	readonly title?: string;
	readonly url?: string;
	/**
	 * Optional grouping key that ties versions of the same domain item
	 * together. Defaults to `id`.
	 */
	readonly subject?: string;
	/** Scheduling state; see {@link ExtensionWorkStatus}. Default: `pending`. */
	readonly status?: ExtensionWorkStatus;
	/** Why held work is `waiting` or `blocked`, shown to operators. */
	readonly blockedReason?: string;
	/**
	 * Absolute per-work directory. Plot creates it before the Agent Run
	 * starts and uses it as the run's working directory. Give concurrent
	 * file-mutating work isolated workspaces.
	 */
	readonly workspace?: string;
	readonly display?: WorkDisplay;
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
export interface ExtensionPaths {
	readonly cwd: string;
	readonly plotDir: string;
	readonly agentDir: string;
	readonly sessionDir: string;
	readonly skillsDir: string;
	readonly extensionsDir: string;
	readonly promptsDir: string;
}

export interface ToolContext<Config = unknown> {
	/** Parsed Workflow definition. */
	readonly workflow: unknown;
	readonly paths: ExtensionPaths;
	/** Extension config after `parseConfig`. */
	readonly config: Config;
	readonly work: ExtensionWork;
	readonly runId: string;
}

/**
 * A static tool definition, or a factory that binds a tool to the selected
 * Work Item and Agent Run. Prefer a factory whenever a mutation must be
 * scoped to one item — closing over `work` lets `execute` re-check identity
 * and version before writing.
 */
export type ExtensionTool<Config = unknown> =
	| ToolDefinition
	| ((context: ToolContext<Config>) => MaybePromise<ToolDefinition>);

export interface ExtensionSetupContext<Config = unknown> {
	/** Parsed Workflow definition. */
	readonly workflow: unknown;
	readonly paths: ToolContext<Config>["paths"];
	/** Extension config after `parseConfig`. */
	readonly config: Config;
	readonly credentials: ExtensionCredentials;
}

export interface ExtensionWorkEvent {
	readonly work: ExtensionWork;
	readonly runId: string;
}

export type ExtensionRunCompletion =
	| {
			readonly status: Extract<AgentRunOutcome, "succeeded">;
			readonly output?: unknown;
	  }
	| {
			readonly status: Extract<AgentRunOutcome, "failed">;
			readonly error: unknown;
	  }
	| {
			readonly status: Extract<AgentRunOutcome, "interrupted">;
			readonly reason?: string;
	  }
	| {
			readonly status: Extract<AgentRunOutcome, "timed_out">;
			readonly reason?: string;
	  };

export interface ExtensionRunFinishedEvent extends ExtensionWorkEvent {
	readonly completion: ExtensionRunCompletion;
}

/**
 * A recorded human decision on a Work Item. The hook is bookkeeping — a later
 * `discover` remains the authority on what the decision means for the work.
 */
export interface OperatorActionEvent extends Pick<
	OperatorObservationInput,
	"actionId" | "comment" | "actor" | "clientId"
> {
	readonly work: ExtensionWork;
	readonly actionLabel: string;
	readonly timestamp: string;
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

/** Signals that cached authorization is no longer usable and needs a person. */
export class ExtensionActionRequiredError extends Error {
	override readonly name = "ExtensionActionRequiredError";
	readonly requirementId: string;

	constructor(input: {
		readonly requirementId: string;
		readonly message: string;
	}) {
		super(input.message);
		this.requirementId = input.requirementId;
	}
}

/**
 * The per-session runtime returned by {@link Extension.create}.
 *
 * Plot owns scheduling around this runtime: it polls `discover` once per
 * tick, claims and dispatches eligible work, drains superseded or absent
 * work, and redispatches failed or timed-out runs with exponential backoff
 * (reset by success, interruption, disappearance, or a new version). Hooks
 * are bookkeeping around that Plot-owned lifecycle — do not launch agents or
 * implement a second scheduler from them.
 */
export interface ExtensionRuntime<Config = unknown> {
	/**
	 * Source prerequisites. Plot checks all of them before every discovery
	 * tick and preserves last-known Work Items while any is non-ready.
	 */
	readonly requirements?: readonly ExtensionRequirement[];
	/** Tools and per-run tool factories exposed by this Source. */
	readonly tools?: readonly ExtensionTool<Config>[];
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
		context: ExtensionRuntimeContext,
	) => MaybePromise<readonly ExtensionWork[]>;
	/** Called after Plot claims work, before the Agent Run starts. */
	readonly started?: (event: ExtensionWorkEvent) => MaybePromise<void>;
	/** Called exactly once after an admitted Agent Run completion. */
	readonly finished?: (event: ExtensionRunFinishedEvent) => MaybePromise<void>;
	/** Called after a human takes an Operator Action on this Source's work. */
	readonly operatorAction?: (event: OperatorActionEvent) => MaybePromise<void>;
	/**
	 * Runs once at session end, after active runs receive interruption
	 * bookkeeping. Cleanup is protected even when other hooks fail.
	 */
	readonly shutdown?: (context: ExtensionRuntimeContext) => MaybePromise<void>;
}

/**
 * An extension module exports this as `default` or as named export
 * `extension`.
 */
export interface Extension<Config = unknown> {
	/**
	 * Stable Source id, part of every work key. Keep it constant across
	 * sessions and versions of the extension.
	 */
	readonly id: string;
	readonly label?: string;
	/**
	 * Optional boundary validator for the Workflow's `extension.config`
	 * value. Throw on invalid input; the parsed result is what `create` and
	 * tool factories receive.
	 */
	readonly parseConfig?: (input: unknown) => MaybePromise<Config>;
	/**
	 * Setup, run once per Session. Build clients and return the runtime,
	 * including any tools. Do not start Agent Sessions or schedulers here.
	 */
	readonly create: (
		context: ExtensionSetupContext<Config>,
	) => MaybePromise<ExtensionRuntime<Config>>;
}

export const defineExtension = <Config>(
	extension: Extension<Config>,
): Extension<Config> => extension;

export type AgentThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface AgentConfig {
	readonly provider: string;
	readonly model: string;
	readonly thinking?: AgentThinkingLevel;
	readonly tools?: readonly string[];
	readonly excludeTools?: readonly string[];
	readonly noTools?: boolean | "all" | "builtin";
	readonly allowProjectConfig?: boolean;
	readonly maxTurns?: number;
}

export interface WorkflowConfig {
	/** Scheduler poll cadence. Default: 30s. */
	readonly tickIntervalMs?: number | undefined;
	readonly maxRunDurationMs?: number | undefined;
	/** Interrupt an Agent Run after this much time without activity. */
	readonly stallTimeoutMs?: number | undefined;
}

export interface WorkflowResources {
	readonly systemPrompt?: string;
	readonly appendSystemPrompt?: readonly string[];
}

export interface WorkflowExtensionOptions {
	readonly config?: unknown;
	readonly maxConcurrentRuns?: number | undefined;
}

export interface WorkflowExtensionBinding<
	Config = unknown,
> extends WorkflowExtensionOptions {
	readonly use: Extension<Config>;
}

export interface WorkflowDefinition<Config = unknown> {
	readonly name: string;
	readonly agent: AgentConfig;
	readonly plot?: WorkflowConfig;
	readonly resources?: WorkflowResources;
	readonly extension: WorkflowExtensionBinding<Config>;
	readonly prompt: string;
}

const workflowBrand: unique symbol = Symbol("plot-ai.workflow");

export type Workflow<Config = unknown> = WorkflowDefinition<Config> & {
	readonly [workflowBrand]: true;
};

export const defineWorkflow = <Config>(
	workflow: WorkflowDefinition<Config>,
): Workflow<Config> =>
	Object.freeze({
		...workflow,
		[workflowBrand]: true,
	}) as Workflow<Config>;
