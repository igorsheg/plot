import type {
	Diagnostic,
	Observation,
	ReconcileProposal,
	RuntimeSnapshot,
	WorkItem,
	WorkRun,
} from "./model.js";

export interface PhaseContext {
	sourceId: string;
	tickId: number;
	snapshot: RuntimeSnapshot;
	signal: AbortSignal;
}

export interface WorkSourcePolicy {
	maxConcurrentRuns?: number;
}

export interface ContinuationContext extends PhaseContext {
	run: WorkRun;
	work: WorkItem;
	turnNumber: number;
}

export interface WorkSource {
	id: string;
	policy?: WorkSourcePolicy;
	observeTick?: (
		context: PhaseContext,
	) => Observation[] | Promise<Observation[]>;
	reconcile?: (
		context: PhaseContext,
	) => ReconcileProposal[] | Promise<ReconcileProposal[]>;
	selectWork?: (context: PhaseContext) => WorkItem[] | Promise<WorkItem[]>;
	continueWork?: (context: ContinuationContext) => boolean | Promise<boolean>;
}

export interface AgentPolicy {
	maxConcurrentRuns?: number;
	validate?: (
		snapshot: RuntimeSnapshot,
	) => Diagnostic[] | Promise<Diagnostic[]>;
}
