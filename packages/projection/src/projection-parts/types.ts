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
export type WorkStatus =
	| "pending"
	| "waiting"
	| "running"
	| "blocked"
	| "draining";
export type AttemptStage =
	| "starting"
	| "working"
	| "verifying"
	| "finishing"
	| "failed";
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

export interface RuntimeIdentityProjection {
	readonly cwdName: string;
	readonly cwd: string;
	readonly workflowPath?: string | undefined;
	readonly provider?: string | undefined;
	readonly model?: string | undefined;
	readonly thinking?: string | undefined;
	readonly skills: readonly string[];
	readonly skillPaths: readonly string[];
	readonly tickIntervalMs?: number | undefined;
	readonly maxConcurrentRuns?: number | undefined;
	readonly maxRunDurationMs?: number | undefined;
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
export type SourceReadiness =
	| "checking"
	| "ready"
	| "action-required"
	| "unavailable";
export interface SourceRequirementProjection {
	readonly id: string;
	readonly label: string;
	readonly status: SourceReadiness;
	readonly message?: string | undefined;
	readonly retryAfterMs?: number | undefined;
	readonly actions?: readonly unknown[] | undefined;
}
export interface SourceActionProjection {
	readonly actionRunId: string;
	readonly requirementId: string;
	readonly actionId: string;
	readonly status: "running" | "failed" | "cancelled";
	readonly progress?: string | undefined;
}
export interface SourceProjection {
	readonly sourceId: string;
	readonly label: string;
	readonly readiness: SourceReadiness;
	readonly message?: string | undefined;
	readonly requirements: readonly SourceRequirementProjection[];
	readonly diagnostics: readonly string[];
	readonly action?: SourceActionProjection | undefined;
}
export interface WorkItemProjection {
	readonly workKey: string;
	readonly sourceId: string;
	readonly subject?: string | undefined;
	readonly primary?: string | undefined;
	readonly title: string;
	readonly subtitle?: string | undefined;
	readonly url?: string | undefined;
	readonly version?: string | undefined;
	readonly labels: readonly string[];
	readonly status: WorkStatus;
	readonly blockedReason?: string | undefined;
	readonly operatorActions?: readonly unknown[] | undefined;
	readonly currentRunId?: string | undefined;
}
export interface AgentAttemptProjection {
	readonly runId: string;
	readonly workKey: string;
	readonly sourceId: string;
	readonly subject?: string | undefined;
	readonly stage: AttemptStage;
	readonly startedAtSeq: number;
	readonly lastEventSeq: number;
	readonly startedAtMs?: number;
	readonly lastEventAtMs?: number;
	readonly turnCount: number;
	readonly eventCount: number;
	readonly meaningfulCount: number;
	readonly toolUpdateCount: number;
	readonly messageCount: number;
	readonly activity: string;
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
export interface CompletedWorkProjection {
	readonly workKey: string;
	readonly runId?: string | undefined;
	readonly label: string;
	readonly status: string;
	readonly message: string;
	readonly atMs: number;
	readonly durationMs?: number | undefined;
	readonly url?: string | undefined;
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
export interface UsageTotals {
	readonly tokens: number;
	readonly cost?: number | undefined;
}
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
