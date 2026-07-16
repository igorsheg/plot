import type { WorkflowConfig, WorkflowExtensionOptions } from "@plot/sdk";
import type { OperatorAction } from "@plot/sdk/work-contract";
import type {
	AgentRunStage,
	AgentRunState,
	CompletedWorkState,
	ObservedWorkItemState,
	ObservedWorkStatus,
	SourceActionState,
	SourceRequirementState,
	SourceState,
	UsageTotals as RuntimeUsageTotals,
} from "@plot/sdk/runtime-contract";
import type { RuntimeEvent } from "@plot/session/runtime";

export type ProjectableEvent = RuntimeEvent;

export interface ProjectableEventRecord {
	readonly kind: string;
	readonly event: ProjectableEvent;
}

export type DashboardStatus =
	| "starting"
	| "idle"
	| "running"
	| "shutting_down"
	| "paused"
	| "stopped"
	| "error";
export type WorkStatus = ObservedWorkStatus;
export type AttemptStage = AgentRunStage;
export type ActivityKind =
	| "think"
	| "read"
	| "edit"
	| "search"
	| "run"
	| "test"
	| "finish"
	| "message"
	| "wait";
export type ActivityTone = "ok" | "bad" | "info";
export type WorkCheck = "not-run" | "running" | "passed" | "failed";

export interface RuntimeIdentityProjection
	extends
		Pick<WorkflowConfig, "tickIntervalMs" | "maxRunDurationMs">,
		Pick<WorkflowExtensionOptions, "maxConcurrentRuns"> {
	readonly cwdName: string;
	readonly cwd: string;
	readonly workflowPath?: string | undefined;
	readonly provider?: string | undefined;
	readonly model?: string | undefined;
	readonly thinking?: string | undefined;
	readonly skills: readonly string[];
	readonly skillPaths: readonly string[];
}
export interface PhaseEntry {
	readonly kind: ActivityKind;
	readonly count: number;
	readonly startedAtMs: number;
	readonly target?: string;
}
export interface TimelineEntry {
	readonly atMs: number;
	readonly text: string;
	readonly kind: ActivityKind;
}
export interface ActiveTool {
	readonly kind: ActivityKind;
	readonly isCheck: boolean;
	readonly target?: string | undefined;
	readonly toolCallId?: string;
}
export interface AttemptStreams {
	readonly tool?: string | undefined;
	readonly thinking?: string | undefined;
	readonly message?: string | undefined;
}
export interface AttemptNarrative {
	readonly kind: "message" | "thinking";
	readonly text: string;
}
export interface TokenUsageProjection {
	readonly input?: number | undefined;
	readonly output?: number | undefined;
	readonly total?: number | undefined;
	readonly cost?: number;
}
export interface AgentTranscriptReference {
	readonly id?: string | undefined;
	readonly path?: string;
}
export type { SourceReadiness } from "@plot/sdk/runtime-contract";
export type SourceRequirementProjection = SourceRequirementState;
export type SourceActionProjection = SourceActionState;
export interface SourceProjection extends SourceState {
	readonly diagnostics: readonly string[];
}
export interface WorkItemProjection extends ObservedWorkItemState {
	readonly primary?: string | undefined;
	readonly operatorActions?: readonly OperatorAction[] | undefined;
	readonly currentRunId?: string | undefined;
}
export interface AgentAttemptProjection extends AgentRunState {
	readonly runId: string;
	readonly subject?: string | undefined;
	readonly startedAtSeq: number;
	readonly lastEventSeq: number;
	readonly startedAtMs?: number;
	readonly lastEventAtMs?: number;
	readonly meaningfulCount: number;
	readonly toolUpdateCount: number;
	readonly messageCount: number;
	readonly activityKind: ActivityKind;
	readonly streaming: boolean;
	readonly lastDisplay: string;
	readonly check: WorkCheck;
	readonly commands: readonly string[];
	readonly observations: readonly string[];
	readonly streams: AttemptStreams;
	readonly lastNarrative?: AttemptNarrative | undefined;
	readonly phases: readonly PhaseEntry[];
	readonly timeline: readonly TimelineEntry[];
	readonly activeTool?: ActiveTool | undefined;
	readonly activeTools?: ReadonlyMap<string, ActiveTool> | undefined;
	readonly tokens?: TokenUsageProjection | undefined;
	readonly usageKeys?: readonly string[] | undefined;
	readonly transcript?: AgentTranscriptReference | undefined;
}
export interface CompletedWorkProjection extends CompletedWorkState {
	readonly runId?: string | undefined;
	readonly atMs: number;
	readonly labels?: readonly string[] | undefined;
	readonly tokens?: TokenUsageProjection | undefined;
}
export interface ScheduledWakeProjection {
	readonly dueAtMs: number;
	readonly delayMs: number;
	readonly reason?: string | undefined;
	readonly workKey?: string | undefined;
	readonly attempt?: number | undefined;
}
export interface ActivityEntry {
	readonly atMs: number;
	readonly tone: ActivityTone;
	readonly text: string;
}
export interface LoopPulse {
	readonly tickId: number;
	readonly atMs: number;
	readonly found: number;
	readonly started: number;
}
export type UsageTotals = RuntimeUsageTotals;
export interface TokenSample {
	readonly atMs: number;
	readonly tokens: number;
}
export interface DashboardProjection {
	readonly sessionId: string;
	readonly workflowName: string;
	readonly runtime: RuntimeIdentityProjection;
	readonly status: DashboardStatus;
	readonly frontier: number;
	readonly pulse?: LoopPulse | undefined;
	readonly usageTotals: UsageTotals;
	readonly tokenSamples: readonly TokenSample[];
	readonly sources: ReadonlyMap<string, SourceProjection>;
	readonly work: ReadonlyMap<string, WorkItemProjection>;
	readonly attempts: ReadonlyMap<string, AgentAttemptProjection>;
	readonly completed: readonly CompletedWorkProjection[];
	readonly diagnostics: readonly string[];
	readonly scheduledWakes: readonly ScheduledWakeProjection[];
	readonly activity: readonly ActivityEntry[];
	readonly debugEvents: readonly string[];
}
