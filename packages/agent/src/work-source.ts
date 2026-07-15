import type {
	Completion,
	Observation,
	WakeRequest,
	SourceRecord,
	SourceWorkRecord,
	WorkItem,
	WorkRun,
} from "./model.js";

export interface SourceActiveRun {
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly state: "running" | "draining";
}

export interface SourcePhaseContext {
	readonly sourceId: string;
	readonly tickId: number;
	readonly signal: AbortSignal;
}

export interface SourceReconcileContext extends SourcePhaseContext {
	readonly observed: readonly Observation[];
	readonly operatorObservations: readonly Observation[];
	readonly activeRuns: readonly SourceActiveRun[];
}

export interface SourceReconciliation {
	readonly source: SourceRecord;
	readonly work: readonly SourceWorkRecord[];
	readonly dispatch: readonly WorkItem[];
	readonly cancel?: readonly {
		readonly workKey: string;
		readonly reason: string;
	}[];
	readonly wakes?: readonly WakeRequest[];
}

export interface SourceRunContext {
	readonly run: WorkRun;
	readonly work: WorkItem;
}

export interface SourceRunFinishedContext extends SourceRunContext {
	readonly completion: Completion;
}

export interface SourceContinuationContext extends SourceRunContext {
	readonly turnNumber: number;
	readonly signal: AbortSignal;
}

export interface WorkSource {
	readonly id: string;
	readonly initial: SourceRecord;
	readonly maxConcurrentRuns: number;
	readonly observe: (
		context: SourcePhaseContext,
	) => readonly Observation[] | Promise<readonly Observation[]>;
	readonly reconcile: (
		context: SourceReconcileContext,
	) => SourceReconciliation | Promise<SourceReconciliation>;
	readonly started: (context: SourceRunContext) => void | Promise<void>;
	readonly finished: (
		context: SourceRunFinishedContext,
	) => void | Promise<void>;
	readonly continueWork: (
		context: SourceContinuationContext,
	) => boolean | Promise<boolean>;
}
