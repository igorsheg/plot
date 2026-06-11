import { describe, expect, test } from "bun:test";
import type { PlotServerRecord } from "@plot/session/protocol";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
} from "../src/projection.js";

const eventRecord = (sequence: number, event: unknown): PlotServerRecord => ({
	protocol: "plot.v1",
	kind: "event",
	sessionId: "default",
	epoch: "epoch-1",
	sequence,
	event,
});

const workStarted = (sequence: number, workKey = "source:item:42") =>
	eventRecord(sequence, {
		type: "plot_agent_event",
		sessionId: "default",
		sequence,
		event: {
			type: "work_started",
			run: {
				runId: "run-1",
				sourceId: "extension:worker",
				workKey,
				subject: "source:item:42",
			},
		},
	});

const agentEvent = (
	sequence: number,
	message: string,
	workKey = "source:item:42",
) =>
	eventRecord(sequence, {
		type: "agent_session_event",
		sessionId: "default",
		sequence,
		sourceId: "extension:worker",
		runId: "run-1",
		workKey,
		subject: "source:item:42",
		eventType: "tool_call",
		event: { type: "tool_call", command: message },
	});

describe("Plot TUI projection", () => {
	test("maps agent activity to operator-facing stages", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, agentEvent(2, "git diff --stat"));
		expect(projection.running.get("source:item:42")?.stage).toBe("exploring");

		projection = reduceRecord(projection, agentEvent(3, "bun run check"));
		expect(projection.running.get("source:item:42")?.stage).toBe("testing");
		expect(projection.running.get("source:item:42")?.check).toBe("running");

		projection = reduceRecord(projection, agentEvent(4, "read src/index.ts"));
		expect(projection.running.get("source:item:42")?.stage).toBe("reading");

		projection = reduceRecord(projection, agentEvent(5, "publish result"));
		expect(projection.running.get("source:item:42")?.stage).toBe("publishing");

		projection = reduceRecord(projection, agentEvent(6, "auth required"));
		expect(projection.running.get("source:item:42")?.stage).toBe("blocked");
	});

	test("keeps raw debug events separate from projected timeline", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, agentEvent(2, "bun run check"));

		expect(projection.timeline[0]).toContain("tool_call");
		expect(projection.debugEvents[0]).toContain("tool_call");
		expect(projection.debugEvents.length).toBeGreaterThanOrEqual(
			projection.timeline.length,
		);
	});

	test("snapshot repairs running rows by work key", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1, "source:item:1"));
		expect(projection.running.has("source:item:1")).toBe(true);

		projection = applySnapshot(projection, {
			snapshot: {
				running: new Map([
					[
						"source:item:2",
						{
							runId: "run-2",
							sourceId: "extension:worker",
							workKey: "source:item:2",
							subject: "source:item:2",
						},
					],
				]),
				diagnostics: [],
			},
		});

		expect(projection.running.has("source:item:1")).toBe(false);
		expect(projection.running.has("source:item:2")).toBe(true);
	});
});
