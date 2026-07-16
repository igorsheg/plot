import {
	emptyProjection,
	reduceProjectableEvent,
	type DashboardProjection,
} from "@plot/projection";
import type { OperatorAction, OperatorActionConfirm } from "@plot/sdk";
import type {
	AgentRunState,
	CompletedWorkState,
	DiagnosticMessage,
	ObservedWorkItemState,
	SourceActionState,
	SourceRequirementState,
	SourceState,
	UsageTotals,
} from "@plot/sdk/runtime-contract";
import type { RuntimeEvent } from "@plot/session/runtime";

export type Diagnostic = DiagnosticMessage;

export type ActionConfirmationSnapshot = OperatorActionConfirm;
export type ActionSnapshot = OperatorAction;

export type SourceRequirementSnapshot = SourceRequirementState;

export type SourceActionSnapshot = SourceActionState;

export interface SourceSnapshot extends SourceState {
	readonly diagnostics: readonly Diagnostic[];
}

export interface WorkItemSnapshot extends ObservedWorkItemState {
	readonly currentAgentRunId?: string | undefined;
	readonly actions?: readonly ActionSnapshot[] | undefined;
}

export interface AgentRunSnapshot extends AgentRunState {
	readonly agentRunId: string;
	readonly startedAt?: number | undefined;
	readonly updatedAt?: number | undefined;
}

export interface CompletedWorkSnapshot extends CompletedWorkState {
	readonly agentRunId?: string | undefined;
	readonly completedAt: number;
}

export type UsageSnapshot = UsageTotals;

export interface SessionSnapshot {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly sequence: number;
	readonly status:
		| "starting"
		| "idle"
		| "running"
		| "stopping"
		| "stopped"
		| "error";
	readonly sources: readonly SourceSnapshot[];
	readonly workItems: readonly WorkItemSnapshot[];
	readonly agentRuns: readonly AgentRunSnapshot[];
	readonly completedWork: readonly CompletedWorkSnapshot[];
	readonly usage: UsageSnapshot;
	readonly diagnostics: readonly Diagnostic[];
}

export interface SessionObservation {
	readonly getSnapshot: () => SessionSnapshot;
	readonly subscribe: (listener: () => void) => () => void;
	readonly close: () => void;
}

const status = (
	value: DashboardProjection["status"],
): SessionSnapshot["status"] => {
	if (value === "shutting_down") return "stopping";
	if (value === "paused") return "idle";
	return value;
};

const actionSnapshot = (action: OperatorAction): ActionSnapshot =>
	action.confirm === undefined
		? { ...action }
		: { ...action, confirm: { ...action.confirm } };

const sourceActionSnapshot = (
	action: SourceActionState,
): SourceActionSnapshot =>
	action.interaction === undefined
		? { ...action }
		: { ...action, interaction: { ...action.interaction } };

const snapshot = (
	projection: DashboardProjection,
	override?: SessionSnapshot["status"],
): SessionSnapshot => ({
	sessionId: projection.sessionId,
	workflowName: projection.workflowName,
	sequence: projection.frontier,
	status: override ?? status(projection.status),
	sources: [...projection.sources.values()].map((source) => ({
		sourceId: source.sourceId,
		label: source.label,
		readiness: source.readiness,
		message: source.message,
		requirements: source.requirements.map((requirement) => ({
			id: requirement.id,
			label: requirement.label,
			status: requirement.status,
			message: requirement.message,
			retryAfterMs: requirement.retryAfterMs,
			actions: requirement.actions?.map(actionSnapshot),
		})),
		action:
			source.action === undefined
				? undefined
				: sourceActionSnapshot(source.action),
		diagnostics: source.diagnostics.map((message) => ({ message })),
	})),
	workItems: [...projection.work.values()].map((work) => ({
		workKey: work.workKey,
		sourceId: work.sourceId,
		title: work.title,
		status: work.status,
		subject: work.subject,
		subtitle: work.subtitle,
		url: work.url,
		version: work.version,
		labels: [...work.labels],
		blockedReason: work.blockedReason,
		currentAgentRunId: work.currentRunId,
		actions: work.operatorActions?.map(actionSnapshot),
	})),
	agentRuns: [...projection.attempts.values()].map((run) => ({
		agentRunId: run.runId,
		workKey: run.workKey,
		sourceId: run.sourceId,
		stage: run.stage,
		activity: run.activity,
		turnCount: run.turnCount,
		eventCount: run.eventCount,
		startedAt: run.startedAtMs,
		updatedAt: run.lastEventAtMs,
	})),
	completedWork: projection.completed.map((work) => ({
		workKey: work.workKey,
		agentRunId: work.runId,
		label: work.label,
		status: work.status,
		message: work.message,
		completedAt: work.atMs,
		durationMs: work.durationMs,
		url: work.url,
	})),
	usage: {
		tokens: projection.usageTotals.tokens,
		cost: projection.usageTotals.cost,
	},
	diagnostics: projection.diagnostics.map((message) => ({ message })),
});

export class ObservationOwner {
	private projection: DashboardProjection;
	private current: SessionSnapshot;
	private readonly listeners = new Set<() => void>();
	private override: SessionSnapshot["status"] | undefined;
	private finished = false;

	constructor(sessionId: string, workflowName: string, cwd: string) {
		this.projection = emptyProjection(sessionId, workflowName, {
			cwd,
			cwdName: cwd.split(/[\\/]/).at(-1) ?? cwd,
			skills: [],
			skillPaths: [],
		});
		this.current = snapshot(this.projection);
	}

	accept(event: unknown): void {
		this.projection = reduceProjectableEvent(
			this.projection,
			event as RuntimeEvent,
		);
		this.publish();
	}

	setStatus(next: SessionSnapshot["status"]): void {
		this.override = next;
		this.publish();
	}

	finish(): void {
		this.finished = true;
		this.listeners.clear();
	}

	open(): SessionObservation {
		const owned = new Set<() => void>();
		let closed = false;
		return {
			getSnapshot: () => this.current,
			subscribe: (listener) => {
				if (closed || this.finished) return () => {};
				owned.add(listener);
				this.listeners.add(listener);
				return () => {
					owned.delete(listener);
					this.listeners.delete(listener);
				};
			},
			close: () => {
				closed = true;
				for (const listener of owned) this.listeners.delete(listener);
				owned.clear();
			},
		};
	}

	private publish(): void {
		this.current = snapshot(this.projection, this.override);
		for (const listener of this.listeners) listener();
	}
}
