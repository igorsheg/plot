import type { Effect } from "effect";
import type {
	Diagnostic,
	Observation,
	PluginActResult,
	PluginId,
	ReconcileProposal,
	RuntimeSnapshot,
	TickId,
} from "./domain.js";

export interface PhaseContext {
	readonly pluginId: PluginId;
	readonly tickId: TickId;
	readonly snapshot: RuntimeSnapshot;
}

export interface PlotPlugin {
	readonly id: PluginId;
	readonly observeTick?: (
		context: PhaseContext,
	) => Effect.Effect<readonly Observation[], unknown>;
	readonly reconcile?: (
		context: PhaseContext,
	) => Effect.Effect<readonly ReconcileProposal[], unknown>;
	readonly act?: (
		context: PhaseContext,
	) => Effect.Effect<PluginActResult, unknown>;
}

export interface OrchestratorPolicy {
	readonly maxConcurrentRuns?: number;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => Effect.Effect<readonly Diagnostic[], unknown>;
}
