import type {
	Observation,
	RuntimeSnapshot,
	WorkItem,
	WorkResult,
	WorkRun,
} from "./model.js";

export interface WorkRunnerContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly snapshot: RuntimeSnapshot;
	readonly signal: AbortSignal;
	readonly emitObservation: (
		observation: Observation,
	) => boolean | Promise<boolean>;
	readonly shouldContinue?: (turnNumber: number) => boolean | Promise<boolean>;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => WorkResult | Promise<WorkResult>;
}
