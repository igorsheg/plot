import { describe, expect, test } from "bun:test";
import type { PlotServerRecord } from "@plot/control/protocol";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
} from "@plot/control/projection";

const eventRecord = (sequence: number, event: unknown): PlotServerRecord => ({
	protocol: "plot.v1",
	kind: "event",
	sessionId: "default",
	epoch: "epoch-1",
	sequence,
	event,
});

const plotAgentEvent = (sequence: number, event: Record<string, unknown>) =>
	eventRecord(sequence, {
		type: "plot_agent_event",
		sessionId: "default",
		sequence,
		event,
	});

const workStarted = (sequence: number, workKey = "source:item:42") =>
	plotAgentEvent(sequence, {
		type: "work_started",
		run: {
			runId: "run-1",
			sourceId: "extension:worker",
			workKey,
			subject: "source:item:42",
			display: {
				primary: "#42",
				title: "Fix checkout totals",
				url: "https://example.com/pr/42",
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
	test("maps agent activity to collapsed operator stages", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, agentEvent(2, "git diff --stat"));
		expect(projection.running.get("source:item:42")?.stage).toBe("working");

		projection = reduceRecord(projection, agentEvent(3, "bun run check"));
		expect(projection.running.get("source:item:42")?.stage).toBe("verifying");
		expect(projection.running.get("source:item:42")?.check).toBe("running");

		projection = reduceRecord(projection, agentEvent(4, "publish result"));
		expect(projection.running.get("source:item:42")?.stage).toBe("finishing");

		projection = reduceRecord(projection, agentEvent(5, "auth required"));
		expect(projection.running.get("source:item:42")?.stage).toBe("blocked");
	});

	test("captures the loop pulse from tick_completed", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			plotAgentEvent(1, {
				type: "tick_completed",
				result: {
					tickId: 7,
					selected: [{ workKey: "source:item:42" }],
					started: [{ workKey: "source:item:42" }],
				},
			}),
		);
		expect(projection.pulse).toMatchObject({ tickId: 7, found: 1, started: 1 });
		expect(projection.activity[0]?.text).toContain("tick #7 found 1");
	});

	test("feeds fleet activity from work lifecycle, not raw event spam", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, agentEvent(2, "bun run check"));
		projection = reduceRecord(
			projection,
			plotAgentEvent(3, {
				type: "work_completed",
				completion: {
					workKey: "source:item:42",
					status: "succeeded",
				},
			}),
		);

		expect(projection.activity.map((entry) => entry.text)).toEqual([
			"#42 Fix checkout totals succeeded",
			"#42 Fix checkout totals started",
		]);
		expect(projection.activity[0]?.tone).toBe("ok");
		expect(projection.completed[0]).toMatchObject({
			workKey: "source:item:42",
			label: "#42 Fix checkout totals",
			status: "succeeded",
			url: "https://example.com/pr/42",
		});
		expect(projection.completed[0]?.atMs).toBeGreaterThan(0);
		expect(projection.debugEvents.length).toBeGreaterThanOrEqual(3);
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

	test("previews pi-mono streaming deltas as current activity", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			agentEvent(2, "delta", "source:item:42", "message_update", {
				type: "message_update",
				message: { content: "I am checking the failing p3-serve build now." },
			}),
		);
		projection = reduceRecord(
			projection,
			agentEvent(3, "delta", "source:item:42", "tool_execution_update", {
				type: "tool_execution_update",
				params: {
					msg: { payload: { outputDelta: "yarn install is missing state" } },
				},
			}),
		);

		const work = projection.running.get("source:item:42");
		expect(work?.lastMessage).toBe(
			"command output streaming: yarn install is missing state",
		);
		expect(work?.activity).toBe(
			"command output streaming: yarn install is missing state",
		);
		expect(work?.lastMeaningful).toBe("started");
		expect(work?.messageCount).toBe(1);
		expect(work?.toolUpdateCount).toBe(1);
	});

	test("ignores tool-result usage so totals stay scoped to Agent Runs", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			agentEvent(2, "tool", "source:item:42", "tool_execution_update", {
				type: "tool_execution_update",
				toolName: "load_review_context",
				partialResult: {
					content: [{ type: "text", text: "loaded context" }],
					details: {
						usage: {
							input: 100,
							output: 25,
							totalTokens: 125,
							cost: { total: 0.0125 },
						},
					},
				},
			}),
		);

		const work = projection.running.get("source:item:42");
		expect(work?.tokens).toBeUndefined();
		expect(projection.usageTotals.tokens).toBe(0);
		expect(projection.usageTotals.cost).toBeUndefined();
	});

	test("compacts tool updates out of the per-work timeline", () => {
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
		expect(work?.timeline.map((entry) => entry.text)).toEqual([
			"Ran: gh pr diff 1532",
			"Running: gh pr diff 1532",
			"work started",
		]);
		expect(work?.timeline.every((entry) => entry.atMs > 0)).toBe(true);
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
