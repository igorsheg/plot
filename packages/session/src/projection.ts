import { reduceEvent } from "./projection-parts/events.js";
import { applySnapshot } from "./projection-parts/snapshot.js";
import type {
	DashboardProjection,
	ProjectableEvent,
	ProjectableEventRecord,
	RuntimeIdentityProjection,
} from "./projection-parts/types.js";
import { workLabel } from "./projection-parts/work.js";

export type {
	ActiveTool,
	ActivityEntry,
	ActivityKind,
	ActivityTone,
	AgentAttemptProjection,
	AgentTranscriptReference,
	AttemptStage,
	AttemptStreams,
	CompletedWorkProjection,
	DashboardProjection,
	DashboardStatus,
	LoopPulse,
	PhaseEntry,
	ProjectableEvent,
	ProjectableEventRecord,
	RuntimeIdentityProjection,
	ScheduledWakeProjection,
	TimelineEntry,
	TokenSample,
	TokenUsageProjection,
	UsageTotals,
	WorkCheck,
	WorkItemProjection,
	WorkStatus,
} from "./projection-parts/types.js";
export { applySnapshot, workLabel };

export const emptyProjection = (
	sessionId: string,
	workflowName: string,
	runtime: RuntimeIdentityProjection = {
		cwd: "",
		cwdName: "",
		skills: [],
		skillPaths: [],
	},
): DashboardProjection => ({
	sessionId,
	workflowName,
	runtime,
	status: "starting",
	frontier: 0,
	usageTotals: { tokens: 0 },
	tokenSamples: [],
	work: new Map(),
	attempts: new Map(),
	completed: [],
	diagnostics: [],
	scheduledWakes: [],
	activity: [],
	debugEvents: [],
});

export const reduceProjectableEvent = (
	projection: DashboardProjection,
	event: ProjectableEvent,
): DashboardProjection => {
	if (Number(event.sequence) <= projection.frontier) return projection;
	return {
		...reduceEvent(projection, event),
		frontier: Number(event.sequence),
	};
};

export const reduceRecord = (
	projection: DashboardProjection,
	input: ProjectableEventRecord,
): DashboardProjection => reduceProjectableEvent(projection, input.event);

export const rebuildProjectionFromEventLog = (
	events: readonly ProjectableEvent[],
	seed = emptyProjection("default", "workflow"),
): DashboardProjection => events.reduce(reduceProjectableEvent, seed);

export const safeParseDashboardProjection = (value: unknown) => ({
	success: true as const,
	data: value as DashboardProjection,
});
