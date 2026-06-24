import { describe, expect, test } from "bun:test";
import {
	plotProtocolVersion,
	type PlotServerRecord,
} from "@plot/session/protocol";
import { dashboardModelFrom } from "../src/dashboard-model.js";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
} from "../src/projection.js";

const eventRecord = (
	sequence: number,
	type: string,
	payload: unknown,
	kind: "event" | "session_event" = "session_event",
): PlotServerRecord => ({
	protocol: plotProtocolVersion,
	kind,
	sessionId: "default",
	epoch: "epoch-1",
	sequence,
	event: {
		sessionId: "default",
		epoch: "epoch-1",
		sequence,
		timestamp: "2026-06-15T00:00:00.000Z",
		type,
		payload,
	},
});

const started = eventRecord(1, "attempt_started", {
	run: {
		runId: "run-1",
		workKey: "source:item:42",
		sourceId: "extension:worker",
		display: { primary: "#42", title: "Fix checkout" },
	},
});
const agentEventRecord = (
	sequence: number,
	event: unknown,
	timestamp = "2026-06-15T00:00:00.000Z",
): PlotServerRecord => ({
	protocol: plotProtocolVersion,
	kind: "event",
	event: {
		kind: "agent_session_event",
		sessionId: "default",
		sequence,
		timestamp,
		type: "agent_session_event",
		runId: "run-1",
		workKey: "source:item:42",
		sourceId: "extension:worker",
		event,
	},
});

describe("Plot TUI projection", () => {
	test("replays canonical work and attempt state", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		expect(p.work.get("source:item:42")?.status).toBe("running");
		expect(p.attempts.has("run-1")).toBe(true);
	});

	test("accepts protocol event records", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(
			p,
			eventRecord(
				1,
				"attempt_started",
				{
					run: {
						runId: "run-1",
						workKey: "source:item:42",
						sourceId: "extension:worker",
						display: { primary: "#42", title: "Fix checkout" },
					},
				},
				"event",
			),
		);
		expect(p.work.get("source:item:42")?.status).toBe("running");
	});

	test("completed attempts stay completed when late agent events arrive", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			eventRecord(2, "attempt_completed", {
				completion: {
					runId: "run-1",
					workKey: "source:item:42",
					status: "succeeded",
				},
			}),
		);
		p = reduceRecord(
			p,
			eventRecord(3, "agent_run_event", {
				runId: "run-1",
				event: { type: "message_delta", text: "late" },
			}),
		);
		expect(p.attempts.has("run-1")).toBe(false);
		expect(p.completed[0]?.status).toBe("succeeded");
	});

	test("tracks pi-mono usage for totals and throughput", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentEventRecord(
				2,
				{
					type: "message_end",
					message: {
						usage: {
							inputTokens: 10,
							outputTokens: 5,
							totalTokens: 15,
							cost: { total: 0.001 },
						},
					},
				},
				"2026-06-15T00:00:10.000Z",
			),
		);
		p = reduceRecord(
			p,
			agentEventRecord(
				3,
				{
					type: "message_end",
					message: { usage: { input: 4, output: 6 } },
				},
				"2026-06-15T00:00:20.000Z",
			),
		);
		expect(p.attempts.get("run-1")?.tokens).toEqual({
			input: 14,
			output: 11,
			total: 25,
			cost: 0.001,
		});
		expect(p.usageTotals).toEqual({ tokens: 25, cost: 0.001 });
		const pulse = dashboardModelFrom(
			p,
			Date.parse("2026-06-15T00:00:20.000Z"),
		).pulse;
		expect(pulse.throughput).toBe("1 tok/s");
		expect(pulse.throughputGraph).toBe("▁▁▁▁▁▁▁█");
	});

	test("humanizes streaming tool-call arguments instead of showing raw JSON", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentEventRecord(2, {
				type: "message_update",
				assistantMessageEvent: {
					type: "toolcall_delta",
					contentIndex: 0,
					delta: '{"command":"bun run check"',
					partial: {
						content: [
							{
								type: "toolCall",
								id: "tool-1",
								name: "bash",
								arguments: { command: "bun run check" },
							},
						],
					},
				},
			}),
		);
		const attempt = p.attempts.get("run-1");
		expect(attempt?.streams.message).toBeUndefined();
		expect(attempt?.streams.tool).toBe("bun run check");
		expect(attempt?.activityKind).toBe("test");
		expect(attempt?.check).toBe("running");
	});

	test("keeps last prose summary across lifecycle events", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentEventRecord(2, {
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					delta: "checking cache",
					partial: { content: [{ type: "text", text: "checking cache" }] },
				},
			}),
		);
		p = reduceRecord(p, agentEventRecord(3, { type: "message_end" }));
		p = reduceRecord(p, agentEventRecord(4, { type: "turn_start" }));
		expect(dashboardModelFrom(p).work[0]?.activity).toBe(
			"writing: checking cache",
		);
	});

	test("keeps last tool summary across lifecycle events", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentEventRecord(2, {
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "bun run check" },
			}),
		);
		p = reduceRecord(
			p,
			agentEventRecord(3, {
				type: "tool_execution_end",
				toolCallId: "tool-1",
			}),
		);
		p = reduceRecord(p, agentEventRecord(4, { type: "turn_start" }));
		expect(dashboardModelFrom(p).work[0]?.activity).toBe("bun run check");
	});

	test("snapshot repairs visible work and active attempts", () => {
		const p = applySnapshot(emptyProjection("default", "workflow"), {
			asOfSequence: 10,
			snapshot: {
				work: new Map([
					[
						"source:item:2",
						{
							workKey: "source:item:2",
							sourceId: "extension:worker",
							status: "pending",
							display: { title: "Second" },
						},
					],
				]),
				running: new Map([
					[
						"run-2",
						{
							runId: "run-2",
							workKey: "source:item:2",
							sourceId: "extension:worker",
						},
					],
				]),
			},
		});
		expect(p.frontier).toBe(10);
		expect(p.work.has("source:item:2")).toBe(true);
		expect(p.attempts.has("run-2")).toBe(true);
	});
});
