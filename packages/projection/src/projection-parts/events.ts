import { isRecord } from "@plot/common/primitives";
import { reduceAgentEvent } from "./agent-events.js";
import { at, cap, str } from "./helpers.js";
import type {
	AgentAttemptProjection,
	CompletedWorkProjection,
	DashboardProjection,
	ProjectableEvent,
} from "./types.js";
import { displayWork, workLabel } from "./work.js";

const debugEventName = (e: ProjectableEvent) =>
	e.kind === "session_event"
		? `session_event:${e.event.type}`
		: `agent_event:${isRecord(e.event) ? (str(e.event["type"]) ?? "unknown") : "unknown"}`;

const debug = (p: DashboardProjection, e: ProjectableEvent) => ({
	...p,
	debugEvents: cap(
		[`${e.sequence} ${debugEventName(e)}`, ...p.debugEvents],
		200,
	),
});

export const reduceEvent = (
	p0: DashboardProjection,
	e: ProjectableEvent,
): DashboardProjection => {
	const p = debug(p0, e);
	if (e.kind === "agent_event")
		return reduceAgentEvent(p, e, e as unknown as Record<string, unknown>);
	const event = e.event;
	if (event.type === "session_started")
		return {
			...p,
			status: "running",
			pulse: undefined,
			usageTotals: { tokens: 0 },
			tokenSamples: [],
			work: new Map(),
			attempts: new Map(),
			completed: [],
			diagnostics: [],
			scheduledWakes: [],
			activity: [],
		};
	if (event.type === "session_shutdown") return { ...p, status: "stopped" };
	if (event.type === "tick_completed") {
		const r = event.result;
		return {
			...p,
			status: p.attempts.size > 0 || r.started > 0 ? "running" : "idle",
			pulse: {
				tickId: r.tickId,
				atMs: at(e),
				found: r.selected,
				started: r.started,
			},
			diagnostics: r.diagnostics.map((d) => d.message),
		};
	}
	if (event.type === "work_observed") {
		const item = displayWork(
			event.work as unknown as Record<string, unknown>,
			p.work.get(event.work.workKey),
		);
		return { ...p, work: new Map(p.work).set(item.workKey, item) };
	}
	if (event.type === "work_removed") {
		const work = new Map(p.work);
		work.delete(event.workKey);
		return {
			...p,
			work,
			scheduledWakes: p.scheduledWakes.filter(
				(w) => w.workKey !== event.workKey,
			),
		};
	}
	if (event.type === "attempt_started") {
		const run = event.run;
		const item = displayWork(
			{
				...run,
				status: "running",
				currentRunId: run.runId,
			} as unknown as Record<string, unknown>,
			p.work.get(run.workKey),
		);
		const attempt: AgentAttemptProjection = {
			runId: run.runId,
			workKey: run.workKey,
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
			work: new Map(p.work).set(run.workKey, item),
			attempts: new Map(p.attempts).set(run.runId, attempt),
		};
	}
	if (event.type === "attempt_completed") {
		const c = event.completion;
		const key = c.workKey;
		const runId = c.runId;
		const attempts = new Map(p.attempts);
		const a = attempts.get(runId);
		attempts.delete(runId);
		const work = new Map(p.work);
		const item = work.get(key);
		if (item)
			work.set(key, {
				...item,
				status: c.status === "succeeded" ? "done" : "failed",
				currentRunId: undefined,
			});
		const completedMutable: {
			workKey: string;
			runId: string;
			label: string;
			status: string;
			message: string;
			atMs: number;
			durationMs?: number;
			url?: string;
			labels?: readonly string[];
			tokens?: NonNullable<CompletedWorkProjection["tokens"]>;
		} = {
			workKey: key,
			runId,
			label: item ? workLabel(item) : key,
			status: c.status,
			message: c.error ?? "completed",
			atMs: at(e),
		};
		if (a?.startedAtMs !== undefined)
			completedMutable.durationMs = at(e) - a.startedAtMs;
		if (item?.url) completedMutable.url = item.url;
		if (item?.labels.length) completedMutable.labels = item.labels;
		if (a?.tokens) completedMutable.tokens = a.tokens;
		const completed: CompletedWorkProjection = completedMutable;
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
	if (event.type === "wake_scheduled") {
		return {
			...p,
			scheduledWakes: [
				...p.scheduledWakes,
				{
					delayMs: event.delayMs,
					dueAtMs: at(e) + event.delayMs,
					reason: event.reason,
					workKey: event.workKey,
					attempt: event.attempt,
				},
			].toSorted((a, b) => a.dueAtMs - b.dueAtMs),
		};
	}
	return p;
};
