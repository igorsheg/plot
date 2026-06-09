import type { Effect } from "effect";
import type {
	Diagnostic,
	Observation,
	PluginId,
	ReconcileProposal,
	RuntimeSnapshot,
	TickId,
	WorkItem,
	WorkResult,
	WorkRun,
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
	readonly selectWork?: (
		context: PhaseContext,
	) => Effect.Effect<readonly WorkItem[], unknown>;
}

export interface WorkRunnerContext {
	readonly pluginId: PluginId;
	readonly tickId: TickId;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly snapshot: RuntimeSnapshot;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => Effect.Effect<WorkResult, unknown>;
}

export interface OrchestratorPolicy {
	readonly maxConcurrentRuns?: number;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => Effect.Effect<readonly Diagnostic[], unknown>;
}
