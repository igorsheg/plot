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
	eventType = "tool_call",
	event: Record<string, unknown> = { type: eventType, command: message },
) =>
	eventRecord(sequence, {
		type: "agent_session_event",
		sessionId: "default",
		sequence,
		sourceId: "extension:worker",
		runId: "run-1",
		workKey,
		subject: "source:item:42",
		eventType,
		event,
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

		expect(projection.timeline[0]).toContain("Running: bun run check");
		expect(projection.debugEvents[0]).toContain("tool_call");
		expect(projection.debugEvents.length).toBeGreaterThanOrEqual(
			projection.timeline.length,
		);
	});

	test("counts real turns instead of streamed deltas", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			agentEvent(2, "turn", "source:item:42", "turn_start", {
				type: "turn_start",
				turnId: "turn-1",
			}),
		);
		projection = reduceRecord(
			projection,
			agentEvent(3, "delta", "source:item:42", "message_update", {
				type: "message_update",
				text: "partial",
			}),
		);
		projection = reduceRecord(
			projection,
			agentEvent(4, "delta", "source:item:42", "tool_execution_update", {
				type: "tool_execution_update",
				command: "gh pr diff 1532",
			}),
		);
		projection = reduceRecord(
			projection,
			agentEvent(5, "turn", "source:item:42", "turn_start", {
				type: "turn_start",
				turnId: "turn-1",
			}),
		);

		const work = projection.running.get("source:item:42");
		expect(work?.turnCount).toBe(1);
		expect(work?.eventCount).toBe(4);
		expect(work?.messageCount).toBe(1);
		expect(work?.toolUpdateCount).toBe(1);
	});

	test("compacts tool updates out of the operator timeline", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			agentEvent(
				2,
				"gh pr diff 1532",
				"source:item:42",
				"tool_execution_start",
				{
					type: "tool_execution_start",
					command: "gh pr diff 1532",
				},
			),
		);
		projection = reduceRecord(
			projection,
			agentEvent(3, "chunk", "source:item:42", "tool_execution_update", {
				type: "tool_execution_update",
				command: "gh pr diff 1532",
			}),
		);
		projection = reduceRecord(
			projection,
			agentEvent(4, "gh pr diff 1532", "source:item:42", "tool_execution_end", {
				type: "tool_execution_end",
				command: "gh pr diff 1532",
			}),
		);

		const work = projection.running.get("source:item:42");
		expect(work?.timeline).toEqual([
			"#4 Ran: gh pr diff 1532",
			"#2 Running: gh pr diff 1532",
			"#1 work started",
		]);
		expect(projection.timeline.join("\n")).not.toContain(
			"tool_execution_update",
		);
		expect(projection.debugEvents[0]).toContain("tool_execution_end");
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
