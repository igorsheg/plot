import type { Effect } from "effect";
import type {
	Diagnostic,
	Observation,
	SourceId,
	ReconcileProposal,
	RuntimeSnapshot,
	TickId,
	WorkItem,
} from "./domain.js";

export interface PhaseContext {
	readonly sourceId: SourceId;
	readonly tickId: TickId;
	readonly snapshot: RuntimeSnapshot;
}

export interface WorkSource {
	readonly id: SourceId;
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

export interface OrchestratorPolicy {
	readonly maxConcurrentRuns?: number;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => Effect.Effect<readonly Diagnostic[], unknown>;
}
