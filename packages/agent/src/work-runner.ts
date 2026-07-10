import type {
	Observation,
	RuntimeSnapshot,
	WorkItem,
	WorkResult,
	WorkRun,
} from "./model.js";

export interface WorkRunnerContext {
	sourceId: string;
	tickId: number;
	run: WorkRun;
	work: WorkItem;
	snapshot: RuntimeSnapshot;
	signal: AbortSignal;
	emitObservation: (observation: Observation) => boolean | Promise<boolean>;
	reportActivity: () => void;
	shouldContinue?: (turnNumber: number) => boolean | Promise<boolean>;
}

export interface WorkRunner {
	run: (context: WorkRunnerContext) => WorkResult | Promise<WorkResult>;
}
