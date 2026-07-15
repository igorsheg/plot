import type { WorkItem, WorkResult, WorkRun } from "./model.js";

export interface WorkRunnerContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly signal: AbortSignal;
	readonly reportActivity: () => void;
	readonly shouldContinue: (turnNumber: number) => boolean | Promise<boolean>;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => WorkResult | Promise<WorkResult>;
}
