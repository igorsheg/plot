interface ProjectableEvent {
	readonly kind?: string;
	readonly sessionId: string;
	readonly sequence?: number;
	readonly timestamp: string;
	readonly type?: string;
	readonly payload?: unknown;
	readonly event?: unknown;
	readonly [key: string]: unknown;
}

interface ProjectableEventRecord {
	readonly kind: string;
	readonly event: ProjectableEvent;
}

import {
	appendStreamDelta,
	piEventDisplay,
	type PiUsageDelta,
} from "./pi-event-display.js";

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
	| "running"
	| "blocked"
	| "draining"
	| "done"
	| "failed";
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

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

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
	readonly phases: readonly PhaseEntry[];
	readonly timeline: readonly TimelineEntry[];
	readonly activeTool?: ActiveTool | undefined;
	readonly activeTools?: ReadonlyMap<string, ActiveTool> | undefined;
	readonly tokens?: TokenUsageProjection | undefined;
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
	readonly tokens?: TokenUsageProjection;
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
	readonly work: ReadonlyMap<string, WorkItemProjection>;
	readonly attempts: ReadonlyMap<string, AgentAttemptProjection>;
	readonly completed: readonly CompletedWorkProjection[];
	readonly diagnostics: readonly string[];
	readonly scheduledWakes: readonly ScheduledWakeProjection[];
	readonly activity: readonly ActivityEntry[];
	readonly debugEvents: readonly string[];
}

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

const record = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);
const at = (e: ProjectableEvent) => Date.parse(e.timestamp) || Date.now();
const cap = <T>(xs: readonly T[], n: number) => xs.slice(0, n);
const debug = (p: DashboardProjection, e: ProjectableEvent) => ({
	...p,
	debugEvents: cap([`${e.sequence} ${e.type}`, ...p.debugEvents], 200),
});

const display = (v: unknown) => (record(v) ? v : {});
const displayWork = (
	work: Record<string, unknown>,
	previous?: WorkItemProjection,
): WorkItemProjection => {
	const d = display(work["display"]);
	const key = String(work["workKey"] ?? previous?.workKey ?? "work");
	const item: Mutable<WorkItemProjection> = {
		workKey: key,
		sourceId: String(work["sourceId"] ?? previous?.sourceId ?? "source"),
		primary: str(d["primary"]) ?? previous?.primary,
		title: str(d["title"]) ?? str(work["title"]) ?? previous?.title ?? key,
		labels: Array.isArray(d["labels"])
			? d["labels"].filter((x): x is string => typeof x === "string")
			: (previous?.labels ?? []),
		status:
			(str(work["status"]) as WorkStatus | undefined) ??
			previous?.status ??
			"pending",
	};
	const subject = str(work["subject"]);
	const subtitle = str(d["subtitle"]);
	const url = str(d["url"]);
	const version = str(d["version"]);
	const blockedReason = str(work["blockedReason"]);
	const currentRunId = str(work["currentRunId"]) ?? previous?.currentRunId;
	if (subject !== undefined) item.subject = subject;
	if (subtitle !== undefined) item.subtitle = subtitle;
	if (url !== undefined) item.url = url;
	if (version !== undefined) item.version = version;
	if (blockedReason !== undefined) item.blockedReason = blockedReason;
	if (Array.isArray(work["operatorActions"]))
		item.operatorActions = work["operatorActions"];
	else if (previous?.operatorActions !== undefined)
		item.operatorActions = previous.operatorActions;
	if (currentRunId !== undefined) item.currentRunId = currentRunId;
	return item;
};
export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;

const mergeAttempt = (
	a: AgentAttemptProjection,
	patch: Partial<AgentAttemptProjection>,
	e: ProjectableEvent,
): AgentAttemptProjection => ({
	...a,
	lastEventSeq: Number(e.sequence),
	lastEventAtMs: at(e),
	eventCount: a.eventCount + 1,
	...patch,
});
const timeline = (
	a: AgentAttemptProjection,
	text: string,
	kind: ActivityKind,
	when: number,
) => cap([...a.timeline, { atMs: when, text, kind }], 30);
const activeTool = (tool: {
	readonly kind: ActivityKind;
	readonly check: string;
	readonly target?: string | undefined;
	readonly toolCallId?: string | undefined;
}) => {
	const active: Mutable<ActiveTool> = {
		kind: tool.kind,
		isCheck: tool.check === "running",
	};
	if (tool.target !== undefined) active.target = tool.target;
	if (tool.toolCallId !== undefined) active.toolCallId = tool.toolCallId;
	return active;
};
const lifecycleActivity = (
	prev: AgentAttemptProjection,
	summary: string,
): Partial<AgentAttemptProjection> =>
	prev.meaningfulCount === 0 ? { activity: summary, lastDisplay: summary } : {};
const addUsage = (
	previous: AgentAttemptProjection["tokens"],
	usage: PiUsageDelta,
): NonNullable<AgentAttemptProjection["tokens"]> => ({
	input: (previous?.input ?? 0) + (usage.input ?? 0),
	output: (previous?.output ?? 0) + (usage.output ?? 0),
	total: (previous?.total ?? 0) + usage.total,
	cost: (previous?.cost ?? 0) + (usage.cost ?? 0),
});

const reduceAgentEvent = (
	p: DashboardProjection,
	e: ProjectableEvent,
	payload: Record<string, unknown>,
): DashboardProjection => {
	const runId = str(payload["runId"]);
	if (runId === undefined) return p;
	const rawEvent = record(payload["event"]) ? payload["event"] : {};
	const activity = piEventDisplay(rawEvent);
	if (activity === undefined) return p;
	const prev = p.attempts.get(runId);
	if (prev === undefined) return p;
	const when = at(e);
	const handlers = {
		turn_start: () => {
			if (activity.type !== "turn_start") return prev;
			return mergeAttempt(
				prev,
				{
					turnCount: prev.turnCount + 1,
					activityKind: "think",
					streaming: true,
					...lifecycleActivity(prev, activity.summary),
				},
				e,
			);
		},
		turn_end: () => {
			if (activity.type !== "turn_end") return prev;
			return mergeAttempt(
				prev,
				{
					streaming: false,
					streams: {},
					...lifecycleActivity(prev, activity.summary),
					...(activity.usage === undefined
						? {}
						: { tokens: addUsage(prev.tokens, activity.usage) }),
				},
				e,
			);
		},
		thinking: () => {
			if (activity.type !== "thinking") return prev;
			const text = appendStreamDelta(prev.streams.thinking, activity.delta);
			return mergeAttempt(
				prev,
				{
					activity: activity.summary,
					activityKind: "think",
					streaming: true,
					lastDisplay: activity.summary,
					meaningfulCount: prev.meaningfulCount + 1,
					streams: { ...prev.streams, thinking: text },
				},
				e,
			);
		},
		message: () => {
			if (activity.type !== "message") return prev;
			const text = appendStreamDelta(prev.streams.message, activity.delta);
			return mergeAttempt(
				prev,
				{
					messageCount: prev.messageCount + 1,
					activity: activity.summary,
					activityKind: "message",
					streaming: true,
					lastDisplay: activity.summary,
					meaningfulCount: prev.meaningfulCount + 1,
					streams: { ...prev.streams, message: text },
				},
				e,
			);
		},
		tool_start: () => {
			if (activity.type !== "tool_start") return prev;
			const tool = activity.tool;
			const nextActiveTool = activeTool(tool);
			const activeTools = new Map(prev.activeTools ?? []);
			if (tool.toolCallId) activeTools.set(tool.toolCallId, nextActiveTool);
			return mergeAttempt(
				prev,
				{
					stage: tool.stage,
					activity: tool.text,
					activityKind: tool.kind,
					streaming: true,
					lastDisplay: tool.text,
					meaningfulCount: prev.meaningfulCount + 1,
					check: tool.check === "running" ? "running" : prev.check,
					commands:
						tool.kind === "run" ||
						tool.kind === "test" ||
						tool.kind === "finish"
							? [...prev.commands, tool.text]
							: prev.commands,
					activeTool: nextActiveTool,
					activeTools,
					streams: { ...prev.streams, tool: tool.text },
					timeline: timeline(prev, tool.text, tool.kind, when),
				},
				e,
			);
		},
		tool_update: () => {
			if (activity.type !== "tool_update") return prev;
			const tool = activity.tool;
			const nextActiveTool = activeTool(tool);
			const activeTools = new Map(prev.activeTools ?? []);
			if (tool.toolCallId) activeTools.set(tool.toolCallId, nextActiveTool);
			return mergeAttempt(
				prev,
				{
					stage: tool.stage,
					activity: tool.text,
					activityKind: tool.kind,
					streaming: true,
					lastDisplay: tool.text,
					meaningfulCount: prev.meaningfulCount + 1,
					check: tool.check === "running" ? "running" : prev.check,
					toolUpdateCount: prev.toolUpdateCount + 1,
					activeTool: nextActiveTool,
					activeTools,
					streams: { ...prev.streams, tool: tool.text },
				},
				e,
			);
		},
		tool_end: () => {
			if (activity.type !== "tool_end") return prev;
			const activeTools = new Map(prev.activeTools ?? []);
			const active = activity.toolCallId
				? activeTools.get(activity.toolCallId)
				: prev.activeTool;
			if (activity.toolCallId) activeTools.delete(activity.toolCallId);
			return mergeAttempt(
				prev,
				{
					stage: activity.failed ? "failed" : prev.stage,
					check: active?.isCheck
						? activity.failed
							? "failed"
							: "passed"
						: prev.check,
					streaming: activeTools.size > 0,
					activeTools,
					activeTool: activeTools.values().next().value,
					streams: { ...prev.streams, tool: undefined },
				},
				e,
			);
		},
	} satisfies Record<typeof activity.type, () => AgentAttemptProjection>;
	const next = handlers[activity.type]();
	const attempts = new Map(p.attempts).set(runId, next);
	const usage = activity.type === "turn_end" ? activity.usage : undefined;
	const usageTotals =
		usage === undefined
			? p.usageTotals
			: {
					tokens: p.usageTotals.tokens + usage.total,
					...(usage.cost === undefined && p.usageTotals.cost === undefined
						? {}
						: { cost: (p.usageTotals.cost ?? 0) + (usage.cost ?? 0) }),
				};
	return {
		...p,
		attempts,
		usageTotals,
		tokenSamples:
			usageTotals === p.usageTotals
				? p.tokenSamples
				: [...p.tokenSamples, { atMs: when, tokens: usageTotals.tokens }],
	};
};

const reduceEvent = (
	p0: DashboardProjection,
	e: ProjectableEvent,
): DashboardProjection => {
	let p = debug(p0, e);
	const payload = record(e.payload) ? e.payload : {};
	if (e.kind === "agent_event" || e.kind === "agent_session_event")
		return reduceAgentEvent(p, e, e as Record<string, unknown>);
	if (e.type === "session_paused") return { ...p, status: "paused" };
	if (e.type === "session_resumed") return { ...p, status: "running" };
	if (e.type === "session_close_requested")
		return { ...p, status: "shutting_down" };
	if (e.type === "session_shutdown" || e.type === "session_close_completed")
		return { ...p, status: "stopped" };
	if (e.type === "tick_completed") {
		const r = record(payload["result"]) ? payload["result"] : payload;
		const selected = num(r["selectedCount"]) ?? 0;
		const started = num(r["startedCount"]) ?? 0;
		return {
			...p,
			status: p.attempts.size > 0 || started > 0 ? "running" : "idle",
			pulse: {
				tickId: num(r["tickId"]) ?? 0,
				atMs: at(e),
				found: selected,
				started,
			},
			diagnostics: Array.isArray(r["diagnostics"])
				? r["diagnostics"].filter((x): x is string => typeof x === "string")
				: p.diagnostics,
		};
	}
	if (e.type === "work_observed") {
		const w = record(payload["work"]) ? payload["work"] : {};
		const item = displayWork(w, p.work.get(String(w["workKey"])));
		return { ...p, work: new Map(p.work).set(item.workKey, item) };
	}
	if (e.type === "work_removed") {
		const key = str(payload["workKey"]);
		if (!key) return p;
		const work = new Map(p.work);
		work.delete(key);
		return {
			...p,
			work,
			scheduledWakes: p.scheduledWakes.filter((w) => w.workKey !== key),
		};
	}
	if (e.type === "attempt_started") {
		const run = record(payload["run"]) ? payload["run"] : {};
		const runId = String(run["runId"] ?? "run");
		const key = String(run["workKey"] ?? "work");
		const item = displayWork(
			{ ...run, status: "running", currentRunId: runId },
			p.work.get(key),
		);
		const attempt: AgentAttemptProjection = {
			runId,
			workKey: key,
			sourceId: item.sourceId,
			subject: item.subject,
			stage: "starting",
			startedAtSeq: Number(e.sequence),
			lastEventSeq: Number(e.sequence),
			startedAtMs: at(e),
			lastEventAtMs: at(e),
			turnCount: 0,
			eventCount: 0,
			meaningfulCount: 0,
			toolUpdateCount: 0,
			messageCount: 0,
			activity: "starting",
			activityKind: "wait",
			streaming: false,
			lastDisplay: "starting",
			check: "not-run",
			commands: [],
			observations: [],
			streams: {},
			phases: [],
			timeline: [],
		};
		return {
			...p,
			status: "running",
			work: new Map(p.work).set(key, item),
			attempts: new Map(p.attempts).set(runId, attempt),
		};
	}
	if (e.type === "agent_run_event") return reduceAgentEvent(p, e, payload);
	if (e.type === "attempt_completed") {
		const c = record(payload["completion"]) ? payload["completion"] : {};
		const key = String(c["workKey"] ?? "work");
		const runId = str(c["runId"]);
		const attempts = new Map(p.attempts);
		const a = runId ? attempts.get(runId) : undefined;
		if (runId) attempts.delete(runId);
		const work = new Map(p.work);
		const item = work.get(key);
		if (item)
			work.set(key, {
				...item,
				status: c["status"] === "succeeded" ? "done" : "failed",
				currentRunId: undefined,
			});
		const completed: CompletedWorkProjection = {
			workKey: key,
			...(runId ? { runId } : {}),
			label: item ? workLabel(item) : key,
			status: str(c["status"]) ?? "completed",
			message: str(c["error"]) ?? "completed",
			atMs: at(e),
			...(a?.startedAtMs === undefined
				? {}
				: { durationMs: at(e) - a.startedAtMs }),
			...(item?.url ? { url: item.url } : {}),
			...(a?.tokens ? { tokens: a.tokens } : {}),
		};
		return {
			...p,
			status: attempts.size > 0 ? "running" : "idle",
			attempts,
			work,
			completed: cap([completed, ...p.completed], 20),
			activity: cap(
				[
					{
						atMs: at(e),
						tone: completed.status === "succeeded" ? "ok" : "bad",
						text: `${completed.label} ${completed.status}`,
					},
					...p.activity,
				],
				20,
			),
		};
	}
	if (e.type === "wake_scheduled") {
		const delayMs = num(payload["delayMs"]);
		if (delayMs === undefined) return p;
		return {
			...p,
			scheduledWakes: [
				...p.scheduledWakes,
				{
					delayMs,
					dueAtMs: at(e) + delayMs,
					reason: str(payload["reason"]),
					workKey: str(payload["workKey"]),
					attempt: num(payload["attempt"]),
				},
			].toSorted((a, b) => a.dueAtMs - b.dueAtMs),
		};
	}
	return p;
};

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

export const applySnapshot = (
	projection: DashboardProjection,
	data: unknown,
): DashboardProjection => {
	const root = record(data) ? data : {};
	const snap = record(root["snapshot"]) ? root["snapshot"] : root;
	const asOf = num(root["asOfSequence"]);
	const workMap =
		snap["work"] instanceof Map
			? snap["work"]
			: new Map(Object.entries(record(snap["work"]) ? snap["work"] : {}));
	const runningMap =
		snap["running"] instanceof Map
			? snap["running"]
			: new Map(Object.entries(record(snap["running"]) ? snap["running"] : {}));
	let work = new Map<string, WorkItemProjection>();
	for (const [key, value] of workMap)
		if (record(value))
			work.set(
				String(key),
				displayWork(value, projection.work.get(String(key))),
			);
	const attempts = new Map<string, AgentAttemptProjection>();
	for (const value of runningMap.values())
		if (record(value)) {
			const runId = String(value["runId"] ?? "run");
			const key = String(value["workKey"] ?? "work");
			const item = displayWork(
				{ ...value, status: "running", currentRunId: runId },
				work.get(key),
			);
			work.set(key, item);
			attempts.set(
				runId,
				projection.attempts.get(runId) ?? {
					runId,
					workKey: key,
					sourceId: item.sourceId,
					subject: item.subject,
					stage: "working",
					startedAtSeq: projection.frontier,
					lastEventSeq: projection.frontier,
					activity: "running",
					activityKind: "wait",
					streaming: false,
					lastDisplay: "running",
					check: "not-run",
					turnCount: 0,
					eventCount: 0,
					meaningfulCount: 0,
					toolUpdateCount: 0,
					messageCount: 0,
					commands: [],
					observations: [],
					streams: {},
					phases: [],
					timeline: [],
				},
			);
		}
	return {
		...projection,
		work,
		attempts,
		frontier:
			asOf === undefined
				? projection.frontier
				: Math.max(projection.frontier, asOf),
		status:
			attempts.size > 0
				? "running"
				: projection.status === "starting"
					? "idle"
					: projection.status,
	};
};

export const rebuildProjectionFromEventLog = (
	events: readonly ProjectableEvent[],
	seed = emptyProjection("default", "workflow"),
): DashboardProjection => events.reduce(reduceProjectableEvent, seed);
export const safeParseDashboardProjection = (value: unknown) => ({
	success: true as const,
	data: value as DashboardProjection,
});
