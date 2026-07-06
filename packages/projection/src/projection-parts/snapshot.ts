import { isRecord } from "@plot/common/primitives";
import { num } from "./helpers.js";
import type { AgentAttemptProjection, DashboardProjection } from "./types.js";
import { displayWork } from "./work.js";

export const applySnapshot = (
	projection: DashboardProjection,
	data: unknown,
): DashboardProjection => {
	const root = isRecord(data) ? data : {};
	const snap = isRecord(root["snapshot"]) ? root["snapshot"] : root;
	const asOf = num(root["asOfSequence"]);
	const workMap =
		snap["work"] instanceof Map
			? snap["work"]
			: new Map(Object.entries(isRecord(snap["work"]) ? snap["work"] : {}));
	const runningMap =
		snap["running"] instanceof Map
			? snap["running"]
			: new Map(
					Object.entries(isRecord(snap["running"]) ? snap["running"] : {}),
				);
	const work = new Map<string, ReturnType<typeof displayWork>>();
	for (const [key, value] of workMap)
		if (isRecord(value))
			work.set(
				String(key),
				displayWork(value, projection.work.get(String(key))),
			);
	const attempts = new Map<string, AgentAttemptProjection>();
	for (const value of runningMap.values())
		if (isRecord(value)) {
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
