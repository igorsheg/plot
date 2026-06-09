import type { Effect } from "effect";
import type {
	Observation,
	SourceId,
	RuntimeSnapshot,
	TickId,
	WorkItem,
	WorkResult,
	WorkRun,
} from "./domain.js";

export interface WorkRunnerContext {
	readonly sourceId: SourceId;
	readonly tickId: TickId;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly snapshot: RuntimeSnapshot;
	readonly emitObservation: (
		observation: Observation,
	) => Effect.Effect<boolean>;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => Effect.Effect<WorkResult, unknown>;
}
