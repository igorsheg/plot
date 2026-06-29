import { isRecord } from "@plot/common/primitives";
import { reduceAgentEvent } from "./agent-events.js";
import { at, cap, num, str } from "./helpers.js";
import type {
	AgentAttemptProjection,
	CompletedWorkProjection,
	DashboardProjection,
	ProjectableEvent,
} from "./types.js";
import { displayWork, workLabel } from "./work.js";

const debugEventName = (e: ProjectableEvent) => {
	const inner = isRecord(e.event) ? str(e.event["type"]) : undefined;
	return [str(e.kind), str(e.type) ?? inner].filter(Boolean).join(":");
};

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
	let p = debug(p0, e);
	const payload = isRecord(e.payload) ? e.payload : {};
	if (e.kind === "agent_event" || e.kind === "agent_session_event")
		return reduceAgentEvent(p, e, e as Record<string, unknown>);
	if (e.type === "session_started")
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
	if (e.type === "session_paused") return { ...p, status: "paused" };
	if (e.type === "session_resumed") return { ...p, status: "running" };
	if (e.type === "session_close_requested")
		return { ...p, status: "shutting_down" };
	if (e.type === "session_shutdown" || e.type === "session_close_completed")
		return { ...p, status: "stopped" };
	if (e.type === "tick_completed") {
		const r = isRecord(payload["result"]) ? payload["result"] : payload;
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
		const w = isRecord(payload["work"]) ? payload["work"] : {};
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
		const run = isRecord(payload["run"]) ? payload["run"] : {};
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
		const c = isRecord(payload["completion"]) ? payload["completion"] : {};
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
			...(item?.labels.length ? { labels: item.labels } : {}),
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
