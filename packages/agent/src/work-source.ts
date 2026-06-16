import type {
	Diagnostic,
	Observation,
	SourceId,
	ReconcileProposal,
	RuntimeSnapshot,
	TickId,
	WorkItem,
	WorkRun,
} from "./model.js";
import type { MaybePromise } from "./work-runner.js";

export interface PhaseContext {
	readonly sourceId: SourceId;
	readonly tickId: TickId;
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
	readonly id: SourceId;
	readonly policy?: WorkSourcePolicy;
	readonly observeTick?: (
		context: PhaseContext,
	) => MaybePromise<readonly Observation[]>;
	readonly reconcile?: (
		context: PhaseContext,
	) => MaybePromise<readonly ReconcileProposal[]>;
	readonly selectWork?: (
		context: PhaseContext,
	) => MaybePromise<readonly WorkItem[]>;
	readonly continueWork?: (
		context: ContinuationContext,
	) => MaybePromise<boolean>;
}

export interface AgentPolicy {
	readonly maxConcurrentRuns?: number;
	readonly validate?: (
		snapshot: RuntimeSnapshot,
	) => MaybePromise<readonly Diagnostic[]>;
}
