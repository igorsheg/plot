import { expect, test } from "bun:test";
import {
	emptyProjection,
	serializeDashboardProjection,
} from "@plot/session/projection";
import { parsePlotEventRecord } from "../src/api.js";
import { applyProjectionEvent } from "../src/projection-live.js";
import type { WebDashboardProjection } from "../src/api.js";

const base = (): WebDashboardProjection =>
	serializeDashboardProjection(emptyProjection("session-1", "workflow"));

const event = (value: Record<string, unknown>) => {
	const parsed = parsePlotEventRecord({ kind: "event", event: value });
	if (parsed === undefined) throw new Error("invalid event");
	return parsed;
};

test("web live projection accepts agent events and runs the shared reducer", () => {
	const started = event({
		kind: "session_event",
		sessionId: "session-1",
		sequence: 1,
		timestamp: "2026-01-01T00:00:00.000Z",
		type: "attempt_started",
		payload: {
			run: {
				sourceId: "source-1",
				runId: "run-1",
				workKey: "work-1",
				title: "Work 1",
			},
		},
	});
	const agent = event({
		kind: "agent_event",
		sessionId: "session-1",
		sequence: 2,
		timestamp: "2026-01-01T00:00:01.000Z",
		sourceId: "source-1",
		runId: "run-1",
		workKey: "work-1",
		event: { type: "turn_start" },
	});

	const projection = applyProjectionEvent(
		applyProjectionEvent(base(), started),
		agent,
	);

	expect(projection.frontier).toBe(2);
	expect(projection.attempts["run-1"]?.streaming).toBe(true);
	expect(projection.attempts["run-1"]?.activity).toBe("turn started");
});
