import type {
	Diagnostic,
	Observation,
	ReconcileProposal,
	RuntimeSnapshot,
	WorkItem,
	WorkRun,
} from "./model.js";

export interface PhaseContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly snapshot: RuntimeSnapshot;
	readonly signal: AbortSignal;
}

export interface WorkSourcePolicy {
	readonly maxConcurrentRuns?: number;
}

export interface ContinuationContext extends PhaseContext {
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly turnNumber: number;
}

export interface WorkSource {
	readonly id: string;
	readonly policy?: WorkSourcePolicy;
	readonly observeTick?: (
		context: PhaseContext,
	) => readonly Observation[] | Promise<readonly Observation[]>;
	readonly reconcile?: (
		context: PhaseContext,
	) => readonly ReconcileProposal[] | Promise<readonly ReconcileProposal[]>;
	readonly selectWork?: (
		context: PhaseContext,
	) => readonly WorkItem[] | Promise<readonly WorkItem[]>;
	readonly continueWork?: (
		context: ContinuationContext,
	) => boolean | Promise<boolean>;
}

export interface AgentPolicy {
	readonly maxConcurrentRuns?: number;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => readonly Diagnostic[] | Promise<readonly Diagnostic[]>;
}
