import type { RunResponse } from "@plot/registry/ipc";
import type { RunRecord } from "@plot/registry/record";
import { pad, table } from "./render.js";

const agoOf = (record: RunRecord, nowMs: number): string => {
	const ms = Date.parse(record.lastSeenAt ?? record.createdAt);
	if (!Number.isFinite(ms)) return "-";
	const seconds = Math.max(0, Math.round((nowMs - ms) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86_400)}d`;
};

const liveFirst = (runs: readonly RunRecord[]): readonly RunRecord[] =>
	runs.toSorted((left, right) => {
		const alive =
			Number(right.status === "online") - Number(left.status === "online");
		if (alive !== 0) return alive;
		return (
			Date.parse(right.lastSeenAt ?? right.createdAt) -
			Date.parse(left.lastSeenAt ?? left.createdAt)
		);
	});

export const formatRunsTable = (
	runs: readonly RunRecord[],
	nowMs = Date.now(),
): string => {
	if (runs.length === 0) return "No Plot runs.";
	const rows = [
		["ID", "STATUS", "WORKFLOW", "PROJECT", "SEEN", "EVENTS"],
		...liveFirst(runs).map((record) => [
			record.id.slice(0, 8),
			record.status,
			record.workflowName ?? "-",
			record.cwdName ?? record.cwd,
			agoOf(record, nowMs),
			record.lastSequence === undefined ? "-" : `#${record.lastSequence}`,
		]),
	];
	return table(rows);
};

const runLine = (record: RunRecord, nowMs: number): string =>
	`${record.id.slice(0, 8)}  ${record.status}  ${record.workflowName ?? "-"}  ${agoOf(record, nowMs)}`;

export const formatRunStatus = (
	record: RunRecord | undefined,
	nowMs = Date.now(),
): string => {
	if (record === undefined) return "Run not found.";
	const fields: readonly (readonly [string, string | undefined])[] = [
		["id", record.id],
		["status", record.status],
		["workflow", record.workflowName],
		["cwd", record.cwd],
		["session", record.sessionId],
		["seen", agoOf(record, nowMs) + " ago"],
		[
			"events",
			record.lastSequence === undefined
				? undefined
				: `#${record.lastSequence} (${record.lastEventType ?? "event"})`,
		],
		["stderr", record.stderrTail],
	];
	return fields
		.filter(([, value]) => value !== undefined && value !== "")
		.map(([name, value]) => `${pad(name, 9)}${value}`)
		.join("\n");
};

/** Human rendering of run IPC responses; raw JSON stays behind --json. */
export const formatRunResponse = (
	response: RunResponse,
	nowMs = Date.now(),
): string => {
	switch (response.type) {
		case "list_result":
			return formatRunsTable(response.runs, nowMs);
		case "status_result":
			return formatRunStatus(response.run, nowMs);
		case "stop_result":
			return response.run === undefined
				? "Run not found."
				: `Stopped ${runLine(response.run, nowMs)}`;
		case "prune_result":
			return response.removed.length === 0
				? "Nothing to clean."
				: [
						`Cleaned ${response.removed.length} run(s):`,
						...response.removed.map((record) => `  ${runLine(record, nowMs)}`),
					].join("\n");
		case "error":
			return `Error: ${response.error}`;
		default:
			return JSON.stringify(response, null, 2);
	}
};
