import { reduceEvent } from "./projection-parts/events.js";
import { applySnapshot } from "./projection-parts/snapshot.js";
import type {
	ActiveTool,
	AgentAttemptProjection,
	DashboardProjection,
	ProjectableEvent,
	ProjectableEventRecord,
	RuntimeIdentityProjection,
	WorkItemProjection,
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

export interface SerializedAgentAttemptProjection extends Omit<
	AgentAttemptProjection,
	"activeTools"
> {
	readonly activeTools?: readonly (readonly [string, ActiveTool])[] | undefined;
}

export interface SerializedDashboardProjection extends Omit<
	DashboardProjection,
	"work" | "attempts"
> {
	readonly work: Record<string, WorkItemProjection>;
	readonly attempts: Record<string, SerializedAgentAttemptProjection>;
}

const serializeAttempt = (
	attempt: AgentAttemptProjection,
): SerializedAgentAttemptProjection => {
	const { activeTools, ...rest } = attempt;
	return {
		...rest,
		...(activeTools === undefined
			? {}
			: { activeTools: [...activeTools.entries()] }),
	};
};

const hydrateActiveTools = (
	value: unknown,
): ReadonlyMap<string, ActiveTool> | undefined => {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) return new Map(value);
	if (typeof value === "object" && value !== null)
		return new Map(Object.entries(value) as [string, ActiveTool][]);
	return undefined;
};

const hydrateAttempt = (
	attempt: SerializedAgentAttemptProjection,
): AgentAttemptProjection => {
	const { activeTools, ...rest } = attempt;
	return {
		...rest,
		...(activeTools === undefined
			? {}
			: { activeTools: hydrateActiveTools(activeTools) }),
	};
};

export const serializeDashboardProjection = (
	projection: DashboardProjection,
): SerializedDashboardProjection => ({
	...projection,
	work: Object.fromEntries(projection.work),
	attempts: Object.fromEntries(
		[...projection.attempts].map(([key, attempt]) => [
			key,
			serializeAttempt(attempt),
		]),
	),
});

export const hydrateDashboardProjection = (
	projection: SerializedDashboardProjection,
): DashboardProjection => ({
	...projection,
	work: new Map(Object.entries(projection.work)),
	attempts: new Map(
		Object.entries(projection.attempts).map(([key, attempt]) => [
			key,
			hydrateAttempt(attempt),
		]),
	),
});

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
