import type {
	Observation,
	RuntimeSnapshot,
	SourceId,
	TickId,
	WorkItem,
	WorkResult,
	WorkRun,
} from "./model.js";

export type MaybePromise<A> = A | Promise<A>;

export interface WorkRunnerContext {
	readonly sourceId: SourceId;
	readonly tickId: TickId;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly snapshot: RuntimeSnapshot;
	readonly signal: AbortSignal;
	readonly emitObservation: (observation: Observation) => MaybePromise<boolean>;
}

export interface WorkRunner {
	readonly run: (context: WorkRunnerContext) => MaybePromise<WorkResult>;
}
