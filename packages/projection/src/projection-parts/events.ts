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

const completionMessage = (completion: {
	readonly status: string;
	readonly error?: string | undefined;
}): string => {
	if (completion.error !== undefined) return completion.error;
	if (completion.status === "succeeded") return "run succeeded";
	if (completion.status === "failed") return "run failed";
	if (completion.status === "timed_out") return "run timed out";
	if (completion.status === "interrupted") return "run interrupted";
	return `run ${completion.status}`;
};

export const reduceEvent = (
	p0: DashboardProjection,
	e: ProjectableEvent,
): DashboardProjection => {
	const p = debug(p0, e);
	if (e.kind === "agent_event") return reduceAgentEvent(p, e);
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
		const item = displayWork(event.work, p.work.get(event.work.workKey));
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
			},
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
				status: "pending",
				currentRunId: undefined,
			});
		const completed: CompletedWorkProjection = {
			workKey: key,
			runId,
			label: item ? workLabel(item) : key,
			status: c.status,
			message: completionMessage(c),
			atMs: at(e),
			durationMs:
				a?.startedAtMs === undefined ? undefined : at(e) - a.startedAtMs,
			url: item?.url,
			labels: item?.labels.length ? item.labels : undefined,
			tokens: a?.tokens,
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
