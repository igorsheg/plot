import type { Effect, Schema } from "effect";
import type {
	ActionId,
	ActionRequest,
	CapabilityId,
	Diagnostic,
	Observation,
	PluginId,
	PluginManifest,
	ReconcileProposal,
	RuntimeSnapshot,
	SubjectKey,
} from "./domain.js";

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
	readonly input?: Schema.Decoder<unknown>;
	readonly output?: Schema.Decoder<unknown>;
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
