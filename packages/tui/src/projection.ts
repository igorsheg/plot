import type { PlotServerRecord, EventLogEvent } from "@plot/session/protocol";

export type DashboardStatus =
	| "starting"
	| "idle"
	| "running"
	| "shutting_down"
	| "paused"
	| "stopped"
	| "error";
export type TuiStatus = DashboardStatus;
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
	readonly lastMeaningful: string;
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
const at = (e: EventLogEvent) => Date.parse(e.timestamp) || Date.now();
const cap = <T>(xs: readonly T[], n: number) => xs.slice(0, n);
const debug = (p: DashboardProjection, e: EventLogEvent) => ({
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
	return {
		workKey: key,
		sourceId: String(work["sourceId"] ?? previous?.sourceId ?? "source"),
		...(str(work["subject"]) === undefined
			? {}
			: { subject: str(work["subject"]) }),
		primary: str(d["primary"]) ?? previous?.primary,
		title: str(d["title"]) ?? str(work["title"]) ?? previous?.title ?? key,
		...(str(d["subtitle"]) === undefined
			? {}
			: { subtitle: str(d["subtitle"]) }),
		...(str(d["url"]) === undefined ? {} : { url: str(d["url"]) }),
		...(str(d["version"]) === undefined ? {} : { version: str(d["version"]) }),
		labels: Array.isArray(d["labels"])
			? d["labels"].filter((x): x is string => typeof x === "string")
			: (previous?.labels ?? []),
		status:
			(str(work["status"]) as WorkStatus | undefined) ??
			previous?.status ??
			"pending",
		...(str(work["blockedReason"]) === undefined
			? {}
			: { blockedReason: str(work["blockedReason"]) }),
		...(Array.isArray(work["operatorActions"])
			? { operatorActions: work["operatorActions"] }
			: previous?.operatorActions === undefined
				? {}
				: { operatorActions: previous.operatorActions }),
		...(str(work["currentRunId"]) === undefined
			? previous?.currentRunId === undefined
				? {}
				: { currentRunId: previous.currentRunId }
			: { currentRunId: str(work["currentRunId"]) }),
	};
};
export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;

const classifyTool = (
	name: string | undefined,
	args: Record<string, unknown>,
): {
	kind: ActivityKind;
	stage: AttemptStage;
	text: string;
	check: WorkCheck;
	target?: string | undefined;
} => {
	if (name === "read")
		return {
			kind: "read",
			stage: "working",
			text: `read ${str(args["path"]) ?? "file"}`,
			check: "not-run",
			target: str(args["path"]),
		};
	if (name === "grep" || name === "find" || name === "ls")
		return {
			kind: "search",
			stage: "working",
			text: `${name} ${str(args["pattern"]) ?? str(args["path"]) ?? ""}`.trim(),
			check: "not-run",
		};
	if (name === "edit" || name === "write")
		return {
			kind: "edit",
			stage: "working",
			text: `${name} ${str(args["path"]) ?? "file"}`,
			check: "not-run",
			target: str(args["path"]),
		};
	const command = str(args["command"]);
	if (name === "bash" && command !== undefined) {
		if (/\b(test|check|lint|typecheck|tsc|bun test|npm test)\b/.test(command))
			return {
				kind: "test",
				stage: "verifying",
				text: command,
				check: "running",
				target: command,
			};
		if (/\b(gh pr review|gh pr comment|git commit|npm publish)\b/.test(command))
			return {
				kind: "finish",
				stage: "finishing",
				text: command,
				check: "not-run",
				target: command,
			};
		return {
			kind: "run",
			stage: "working",
			text: command,
			check: "not-run",
			target: command,
		};
	}
	return {
		kind: "run",
		stage: "working",
		text: name ?? "tool",
		check: "not-run",
	};
};

const mergeAttempt = (
	a: AgentAttemptProjection,
	patch: Partial<AgentAttemptProjection>,
	e: EventLogEvent,
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

const reduceAgentEvent = (
	p: DashboardProjection,
	e: EventLogEvent,
	payload: Record<string, unknown>,
): DashboardProjection => {
	const runId = str(payload["runId"]);
	if (runId === undefined) return p;
	const event = record(payload["event"]) ? payload["event"] : {};
	const prev = p.attempts.get(runId);
	if (prev === undefined) return p;
	const when = at(e);
	const type = str(event["type"]);
	let next = prev;
	if (type === "turn_start")
		next = mergeAttempt(
			prev,
			{
				turnCount: prev.turnCount + 1,
				activity: "thinking",
				activityKind: "think",
				streaming: true,
			},
			e,
		);
	else if (type === "message_delta" || type === "message_partial")
		next = mergeAttempt(
			prev,
			{
				messageCount: prev.messageCount + 1,
				activity: str(event["text"]) ?? str(event["content"]) ?? prev.activity,
				activityKind: "message",
				streaming: true,
				streams: {
					...prev.streams,
					message:
						str(event["text"]) ?? str(event["content"]) ?? prev.streams.message,
				},
			},
			e,
		);
	else if (type === "thinking_delta")
		next = mergeAttempt(
			prev,
			{
				activity: str(event["text"]) ?? prev.activity,
				activityKind: "think",
				streaming: true,
				streams: {
					...prev.streams,
					thinking: str(event["text"]) ?? prev.streams.thinking,
				},
			},
			e,
		);
	else if (
		type === "tool_execution_start" ||
		type === "tool_execution_update"
	) {
		const args = record(event["args"]) ? event["args"] : {};
		const tool = classifyTool(str(event["toolName"]), args);
		const id = str(event["toolCallId"]);
		const activeTools = new Map(prev.activeTools ?? []);
		if (id)
			activeTools.set(id, {
				kind: tool.kind,
				isCheck: tool.check === "running",
				target: tool.target,
				toolCallId: id,
			});
		next = mergeAttempt(
			prev,
			{
				stage: tool.stage,
				activity: tool.text,
				activityKind: tool.kind,
				streaming: true,
				lastMeaningful: tool.text,
				check: tool.check === "running" ? "running" : prev.check,
				commands:
					tool.kind === "run" || tool.kind === "test" || tool.kind === "finish"
						? [...prev.commands, tool.text]
						: prev.commands,
				toolUpdateCount:
					prev.toolUpdateCount + (type === "tool_execution_update" ? 1 : 0),
				activeTool: {
					kind: tool.kind,
					isCheck: tool.check === "running",
					target: tool.target,
					...(id ? { toolCallId: id } : {}),
				},
				activeTools,
				streams: { ...prev.streams, tool: tool.text },
				timeline: timeline(prev, tool.text, tool.kind, when),
			},
			e,
		);
	} else if (type === "tool_execution_end") {
		const id = str(event["toolCallId"]);
		const activeTools = new Map(prev.activeTools ?? []);
		const active = id ? activeTools.get(id) : prev.activeTool;
		if (id) activeTools.delete(id);
		const failed = event["isError"] === true;
		const check = active?.isCheck ? (failed ? "failed" : "passed") : prev.check;
		next = mergeAttempt(
			prev,
			{
				stage: failed ? "failed" : prev.stage,
				check,
				streaming: activeTools.size > 0,
				activeTools,
				activeTool: activeTools.values().next().value,
				streams: { ...prev.streams, tool: undefined },
			},
			e,
		);
	} else if (type === "turn_end" || type === "agent_end") {
		const usage = record(event["usage"]) ? event["usage"] : undefined;
		const total = num(usage?.["total"]) ?? num(usage?.["totalTokens"]);
		next = mergeAttempt(
			prev,
			{
				streaming: false,
				streams: {},
				...(total === undefined ? {} : { tokens: { total } }),
			},
			e,
		);
	}
	const attempts = new Map(p.attempts).set(runId, next);
	const usageTotals =
		next.tokens?.total === undefined || next.tokens.total === prev.tokens?.total
			? p.usageTotals
			: {
					tokens: p.usageTotals.tokens + next.tokens.total,
					cost: p.usageTotals.cost,
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
	e: EventLogEvent,
): DashboardProjection => {
	let p = debug(p0, e);
	const payload = record(e.payload) ? e.payload : {};
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
			lastMeaningful: "starting",
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
			].sort((a, b) => a.dueAtMs - b.dueAtMs),
		};
	}
	return p;
};

export const reduceEventLogEvent = (
	projection: DashboardProjection,
	event: EventLogEvent,
): DashboardProjection => {
	if (Number(event.sequence) <= projection.frontier) return projection;
	return {
		...reduceEvent(projection, event),
		frontier: Number(event.sequence),
	};
};
export const reduceRecord = (
	projection: DashboardProjection,
	input: PlotServerRecord,
): DashboardProjection =>
	input.kind === "session_event"
		? reduceEventLogEvent(projection, input.event)
		: projection;

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
					lastMeaningful: "running",
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
	events: readonly EventLogEvent[],
	seed = emptyProjection("default", "workflow"),
): DashboardProjection => events.reduce(reduceEventLogEvent, seed);
export const safeParseDashboardProjection = (value: unknown) => ({
	success: true as const,
	data: value as DashboardProjection,
});
