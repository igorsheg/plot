import type { WorkResult } from "./model.js";
import type { SourceRunContext } from "./work-source.js";

export interface WorkRunnerContext extends SourceRunContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly signal: AbortSignal;
	readonly reportActivity: () => void;
	readonly shouldContinue: (turnNumber: number) => boolean | Promise<boolean>;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => WorkResult | Promise<WorkResult>;
}
