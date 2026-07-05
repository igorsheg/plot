import { describe, expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import { parsePlotEventRecord } from "../src/api.js";
import {
	buildReplayLog,
	fetchReplayHistory,
	projectionAt,
	replayEventLimit,
} from "../src/replay.js";
import type { PlotEventRecord, WebDashboardProjection } from "../src/api.js";

const base = (): WebDashboardProjection =>
	serializeDashboardProjection(emptyProjection("session-1", "workflow"));

const event = (value: Record<string, unknown>): PlotEventRecord => {
	const parsed = parsePlotEventRecord({ kind: "event", event: value });
	if (parsed === undefined) throw new Error("invalid event");
	return parsed;
};

const sessionEvent = (
	sequence: number,
	type = "session_started",
): PlotEventRecord =>
	event({
		kind: "session_event",
		sessionId: "session-1",
		sequence,
		timestamp: new Date(sequence * 1000).toISOString(),
		type,
	});

describe("replay", () => {
	test("folds projection at the requested event time", () => {
		const log = buildReplayLog(base(), [
			event({
				kind: "session_event",
				sessionId: "session-1",
				sequence: 1,
				timestamp: "2026-01-01T00:00:01.000Z",
				type: "attempt_started",
				payload: {
					run: {
						sourceId: "source-1",
						runId: "run-1",
						workKey: "work-1",
						title: "Work 1",
					},
				},
			}),
			event({
				kind: "agent_event",
				sessionId: "session-1",
				sequence: 2,
				timestamp: "2026-01-01T00:00:02.000Z",
				sourceId: "source-1",
				runId: "run-1",
				workKey: "work-1",
				event: { type: "turn_start" },
			}),
		]);

		expect(
			projectionAt(log, Date.parse("2026-01-01T00:00:01.500Z")).projection
				.frontier,
		).toBe(1);
		expect(
			projectionAt(log, Date.parse("2026-01-01T00:00:02.500Z")).projection
				.attempts["run-1"]?.streaming,
		).toBe(true);
	});

	test("fetches durable history pages until done or client-capped", async () => {
		const originalFetch = globalThis.fetch;
		const urls: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = String(input);
			urls.push(url);
			const page = url.endsWith("after=0")
				? { records: [sessionEvent(1), sessionEvent(2)], truncated: true }
				: { records: [sessionEvent(3), sessionEvent(4)], truncated: false };
			return new Response(JSON.stringify(page), {
				headers: { "content-type": "application/json" },
			});
		}) as typeof fetch;
		try {
			const complete = await fetchReplayHistory("run-1", { maxEvents: 4 });
			expect(complete.records.map((record) => record.event.sequence)).toEqual([
				1, 2, 3, 4,
			]);
			expect(complete.truncated).toBe(false);

			urls.length = 0;
			const capped = await fetchReplayHistory("run-1", { maxEvents: 3 });
			expect(urls).toEqual([
				"/api/runs/run-1/history?after=0",
				"/api/runs/run-1/history?after=2",
			]);
			expect(capped.records.map((record) => record.event.sequence)).toEqual([
				1, 2, 3,
			]);
			expect(capped.truncated).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("checkpoints every 500 events and caps covered history", () => {
		const records = Array.from({ length: replayEventLimit + 1 }, (_, index) =>
			sessionEvent(index + 1),
		);
		const log = buildReplayLog(base(), records);
		if (log.lastMs === undefined) throw new Error("missing replay range");
		const afterCovered = projectionAt(
			log,
			Date.parse("1970-01-01T06:00:00.000Z"),
		);

		expect(log.events).toHaveLength(replayEventLimit);
		expect(log.checkpoints).toHaveLength(replayEventLimit / 500);
		expect(log.truncated).toBe(true);
		expect(afterCovered.historyTruncated).toBe(true);
		expect(afterCovered.playheadMs).toBe(log.lastMs);
	});
});
