import { reduceEvent } from "./projection-parts/events.js";
import type {
	DashboardProjection,
	ProjectableEvent,
	ProjectableEventRecord,
	RuntimeIdentityProjection,
} from "./projection-parts/types.js";
import { workLabel } from "./projection-parts/work.js";
import {
	hydrateDashboardProjection,
	parseSerializedDashboardProjection,
	serializeDashboardProjection,
	type SerializedAgentAttemptProjection,
	type SerializedDashboardProjection,
} from "./projection-parts/serialization.js";

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
	SourceActionProjection,
	SourceProjection,
	SourceReadiness,
	SourceRequirementProjection,
	TimelineEntry,
	TokenSample,
	TokenUsageProjection,
	UsageTotals,
	WorkCheck,
	WorkItemProjection,
	WorkStatus,
} from "./projection-parts/types.js";
export {
	hydrateDashboardProjection,
	parseSerializedDashboardProjection,
	serializeDashboardProjection,
	workLabel,
};
export type { SerializedAgentAttemptProjection, SerializedDashboardProjection };

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
	sources: new Map(),
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
	if (event.sequence <= projection.frontier) return projection;
	return {
		...reduceEvent(projection, event),
		frontier: event.sequence,
	};
};

export const reduceRecord = (
	projection: DashboardProjection,
	input: ProjectableEventRecord,
): DashboardProjection => reduceProjectableEvent(projection, input.event);
