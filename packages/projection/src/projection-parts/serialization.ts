import { isRecord, type Mutable } from "@plot/common/primitives";
import type {
	ActiveTool,
	ActivityEntry,
	AgentAttemptProjection,
	CompletedWorkProjection,
	DashboardProjection,
	RuntimeIdentityProjection,
	ScheduledWakeProjection,
	TokenSample,
	WorkItemProjection,
} from "./types.js";

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

const asString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asStringArray = (value: unknown): readonly string[] | undefined =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: undefined;

const projectionStatuses = new Set([
	"starting",
	"idle",
	"running",
	"shutting_down",
	"paused",
	"stopped",
	"error",
]);

const emptyRuntime: RuntimeIdentityProjection = {
	cwd: "",
	cwdName: "",
	skills: [],
	skillPaths: [],
};

const parseRuntimeProjection = (value: unknown): RuntimeIdentityProjection => {
	const record = isRecord(value) ? value : undefined;
	const cwd = asString(record?.["cwd"]);
	const cwdName = asString(record?.["cwdName"]);
	if (record === undefined || cwd === undefined || cwdName === undefined) {
		return emptyRuntime;
	}
	return {
		cwd,
		cwdName,
		skills: asStringArray(record["skills"]) ?? [],
		skillPaths: asStringArray(record["skillPaths"]) ?? [],
		workflowPath: asString(record["workflowPath"]),
		provider: asString(record["provider"]),
		model: asString(record["model"]),
		thinking: asString(record["thinking"]),
		tickIntervalMs: asNumber(record["tickIntervalMs"]),
		maxConcurrentRuns: asNumber(record["maxConcurrentRuns"]),
		maxRunDurationMs: asNumber(record["maxRunDurationMs"]),
	};
};

const parseActivityProjection = (value: unknown): readonly ActivityEntry[] =>
	Array.isArray(value)
		? value.flatMap((entry) => {
				const record = isRecord(entry) ? entry : undefined;
				const atMs = asNumber(record?.["atMs"]);
				const tone = asString(record?.["tone"]);
				const text = asString(record?.["text"]);
				return record !== undefined &&
					atMs !== undefined &&
					(tone === "ok" || tone === "bad" || tone === "info") &&
					text !== undefined
					? [{ atMs, tone, text }]
					: [];
			})
		: [];

export const parseSerializedDashboardProjection = (
	value: unknown,
): SerializedDashboardProjection | undefined => {
	const envelope = isRecord(value) ? value : undefined;
	const recordValue = envelope?.["projection"] ?? value;
	const record = isRecord(recordValue) ? recordValue : undefined;
	const sessionId = asString(record?.["sessionId"]);
	const workflowName = asString(record?.["workflowName"]);
	const status = asString(record?.["status"]);
	const frontier = asNumber(record?.["frontier"]);
	if (
		record === undefined ||
		sessionId === undefined ||
		workflowName === undefined ||
		status === undefined ||
		!projectionStatuses.has(status) ||
		frontier === undefined
	) {
		return undefined;
	}
	const usage = isRecord(record["usageTotals"])
		? record["usageTotals"]
		: undefined;
	return {
		sessionId,
		workflowName,
		status: status as SerializedDashboardProjection["status"],
		frontier,
		runtime: parseRuntimeProjection(record["runtime"]),
		usageTotals: {
			tokens: asNumber(usage?.["tokens"]) ?? 0,
			cost: asNumber(usage?.["cost"]),
		},
		tokenSamples: (Array.isArray(record["tokenSamples"])
			? record["tokenSamples"]
			: []) as readonly TokenSample[],
		work: (isRecord(record["work"]) ? record["work"] : {}) as Record<
			string,
			WorkItemProjection
		>,
		attempts: (isRecord(record["attempts"])
			? record["attempts"]
			: {}) as Record<string, SerializedAgentAttemptProjection>,
		completed: (Array.isArray(record["completed"])
			? record["completed"]
			: []) as readonly CompletedWorkProjection[],
		diagnostics: asStringArray(record["diagnostics"]) ?? [],
		scheduledWakes: (Array.isArray(record["scheduledWakes"])
			? record["scheduledWakes"]
			: []) as readonly ScheduledWakeProjection[],
		activity: parseActivityProjection(record["activity"]),
		debugEvents: asStringArray(record["debugEvents"]) ?? [],
	};
};

const serializeAttempt = (
	attempt: AgentAttemptProjection,
): SerializedAgentAttemptProjection => {
	const { activeTools, ...rest } = attempt;
	const serialized: Mutable<SerializedAgentAttemptProjection> = rest;
	if (activeTools !== undefined)
		serialized.activeTools = [...activeTools.entries()];
	return serialized;
};

const isActiveToolEntry = (value: unknown): value is [string, ActiveTool] =>
	Array.isArray(value) &&
	typeof value[0] === "string" &&
	typeof value[1] === "object" &&
	value[1] !== null;

const hydrateActiveTools = (
	value: unknown,
): ReadonlyMap<string, ActiveTool> | undefined => {
	if (value === undefined) return undefined;
	if (Array.isArray(value)) return new Map(value.filter(isActiveToolEntry));
	if (typeof value === "object" && value !== null)
		return new Map(Object.entries(value) as [string, ActiveTool][]);
	return undefined;
};

const hydrateAttempt = (
	attempt: SerializedAgentAttemptProjection,
): AgentAttemptProjection => {
	const { activeTools, ...rest } = attempt;
	const hydrated: Mutable<AgentAttemptProjection> = rest;
	const tools = hydrateActiveTools(activeTools);
	if (tools !== undefined) hydrated.activeTools = tools;
	return hydrated;
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
