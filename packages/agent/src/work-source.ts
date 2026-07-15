import type {
	Completion,
	OperatorObservation,
	SourceRecord,
	SourceWorkRecord,
	WakeRequest,
	WorkItem,
	WorkRun,
} from "./model.js";

export interface SourceActiveRun {
	readonly run: WorkRun;
	readonly work: WorkItem;
}

export interface SourceReconcileContext {
	readonly tickId: number;
	readonly signal: AbortSignal;
	readonly operatorObservations: readonly OperatorObservation[];
	readonly activeRuns: readonly SourceActiveRun[];
}

export interface SourceReconciliation {
	readonly source: SourceRecord;
	readonly work: readonly SourceWorkRecord[];
	readonly dispatch: readonly WorkItem[];
	readonly cancel: readonly {
		readonly workKey: string;
		readonly reason: string;
	}[];
	readonly wakes: readonly WakeRequest[];
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
	readonly initial: SourceRecord;
	readonly maxConcurrentRuns: number;
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
