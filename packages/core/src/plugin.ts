import { Schema, type Effect } from "effect";

export type PluginId = string;
export type CapabilityId = string;
export type SubjectKey = string;
export type ActionId = string;
export type IdempotencyKey = string;

const HookPhase = Schema.Literals([
	"observe",
	"reconcile",
	"plan",
	"capability",
]);
export type HookPhase = typeof HookPhase.Type;

export class PlotLoopError extends Schema.TaggedErrorClass<PlotLoopError>()(
	"PlotLoopError",
	{
		phase: HookPhase,
		message: Schema.String,
		plugin_id: Schema.optional(Schema.String),
		capability_id: Schema.optional(Schema.String),
	},
) {}

export interface Observation {
	readonly type: string;
	readonly subject?: SubjectKey;
	readonly data?: unknown;
}

export interface SetFactProposal {
	readonly type: "set_fact";
	readonly key: string;
	readonly value: unknown;
}

export interface RemoveFactProposal {
	readonly type: "remove_fact";
	readonly key: string;
}

export type ReconcileProposal = SetFactProposal | RemoveFactProposal;

export interface ActionRequest {
	readonly capability: CapabilityId;
	readonly input: unknown;
	readonly subject?: SubjectKey;
	readonly reason?: string;
	readonly priority?: number;
	readonly idempotencyKey?: IdempotencyKey;
}

export interface AdmittedAction extends ActionRequest {
	readonly actionId: ActionId;
	readonly pluginId: PluginId;
}

export type CompletionStatus = "succeeded" | "failed" | "rejected";

export interface Completion {
	readonly actionId: ActionId;
	readonly pluginId: PluginId;
	readonly capabilityId: CapabilityId;
	readonly status: CompletionStatus;
	readonly subject?: SubjectKey;
	readonly output?: unknown;
	readonly error?: string;
}

export interface Diagnostic {
	readonly level: "info" | "warning" | "error";
	readonly phase: HookPhase | "admit" | "policy";
	readonly message: string;
	readonly pluginId?: PluginId;
	readonly capabilityId?: CapabilityId;
	readonly actionId?: ActionId;
}

export interface RuntimeSnapshot {
	readonly tickId: number;
	readonly facts: ReadonlyMap<string, unknown>;
	readonly observations: readonly Observation[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly actionLedger: ReadonlyMap<IdempotencyKey, ActionId>;
}

export interface PhaseContext {
	readonly pluginId: PluginId;
	readonly tickId: number;
	readonly snapshot: RuntimeSnapshot;
}

export interface CapabilityContext {
	readonly pluginId: PluginId;
	readonly tickId: number;
	readonly actionId: ActionId;
	readonly capabilityId: CapabilityId;
	readonly subject?: SubjectKey;
}

export interface PluginManifest {
	readonly uses?: readonly CapabilityId[];
}

export interface PlotPlugin {
	readonly id: PluginId;
	readonly manifest?: PluginManifest;
	readonly observeTick?: (
		context: PhaseContext,
	) => Effect.Effect<readonly Observation[], unknown>;
	readonly reconcile?: (
		context: PhaseContext,
	) => Effect.Effect<readonly ReconcileProposal[], unknown>;
	readonly plan?: (
		context: PhaseContext,
	) => Effect.Effect<readonly ActionRequest[], unknown>;
}

export interface CapabilityDefinition {
	readonly id: CapabilityId;
	readonly execute: (
		context: CapabilityContext,
		input: unknown,
	) => Effect.Effect<unknown, unknown>;
}

export interface OrchestratorPolicy {
	readonly maxActionsPerTick?: number;
	readonly grants?: Readonly<Record<PluginId, readonly CapabilityId[]>>;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => Effect.Effect<readonly Diagnostic[], unknown>;
}

export interface TickResult {
	readonly tickId: number;
	readonly observations: readonly Observation[];
	readonly proposals: readonly ReconcileProposal[];
	readonly planned: readonly ActionRequest[];
	readonly admitted: readonly AdmittedAction[];
	readonly completions: readonly Completion[];
	readonly diagnostics: readonly Diagnostic[];
	readonly snapshot: RuntimeSnapshot;
}

export type OrchestratorMessage =
	| {
			readonly type: "observation";
			readonly observation: Observation;
	  }
	| {
			readonly type: "completion";
			readonly completion: Completion;
	  };
