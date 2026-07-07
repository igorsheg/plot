import { describe, expect, test } from "bun:test";
import {
	sessionProtocolVersion,
	type ServerRecord,
} from "@plot/session/protocol";

type ProjectionEventRecord = Extract<ServerRecord, { kind: "event" }>;
import { dashboardModelFrom } from "../src/dashboard-model.js";
import { emptyProjection, reduceRecord } from "@plot/projection";

const eventRecord = (
	sequence: number,
	event: Extract<
		ProjectionEventRecord["event"],
		{ kind: "session_event" }
	>["event"],
): ProjectionEventRecord => ({
	protocol: sessionProtocolVersion,
	kind: "event",
	event: {
		kind: "session_event",
		sessionId: "default",
		sequence,
		timestamp: "2026-06-15T00:00:00.000Z",
		event,
	},
});

const started = eventRecord(1, {
	type: "attempt_started",
	run: {
		runId: "run-1",
		workKey: "source:item:42",
		sourceId: "extension:worker",
		display: { primary: "#42", title: "Fix checkout" },
	},
});
const agentProjectionEventRecord = (
	sequence: number,
	event: unknown,
	timestamp = "2026-06-15T00:00:00.000Z",
): ProjectionEventRecord => ({
	protocol: sessionProtocolVersion,
	kind: "event",
	event: {
		kind: "agent_event",
		sessionId: "default",
		sequence,
		timestamp,
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

	test("waiting work is visible but not attention", () => {
		const p = {
			...emptyProjection("default", "workflow"),
			work: new Map([
				[
					"waiting",
					{
						workKey: "waiting",
						sourceId: "source",
						title: "Reviewed PR",
						labels: [],
						status: "waiting" as const,
						blockedReason: "reviewed at this head",
					},
				],
				[
					"blocked",
					{
						workKey: "blocked",
						sourceId: "source",
						title: "Needs approval",
						labels: [],
						status: "blocked" as const,
						blockedReason: "needs approval",
					},
				],
			]),
		};

		const model = dashboardModelFrom(p);

		expect(model.work.find((w) => w.work.workKey === "waiting")?.activity).toBe(
			"reviewed at this head",
		);
		expect(model.attention.map((item) => item.workKey)).toEqual(["blocked"]);
	});

	test("accepts protocol event records", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(
			p,
			eventRecord(1, {
				type: "attempt_started",
				run: {
					runId: "run-1",
					workKey: "source:item:42",
					sourceId: "extension:worker",
					display: { primary: "#42", title: "Fix checkout" },
				},
			}),
		);
		expect(p.work.get("source:item:42")?.status).toBe("running");
	});

	test("completed attempts stay completed when late agent events arrive", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			eventRecord(2, {
				type: "attempt_completed",
				completion: {
					runId: "run-1",
					workKey: "source:item:42",
					sourceId: "extension:worker",
					status: "succeeded",
				},
			}),
		);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(3, { type: "message_delta", text: "late" }),
		);
		expect(p.attempts.has("run-1")).toBe(false);
		expect(p.completed[0]?.status).toBe("succeeded");
	});

	test("tracks pi-mono usage for totals and throughput", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(
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
			agentProjectionEventRecord(
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

	test("dedupes message_end and turn_end usage for one response", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		const message = {
			usage: {
				totalTokens: 15,
				cost: { total: 0.001 },
			},
			responseId: "resp-1",
		};
		p = reduceRecord(
			p,
			agentProjectionEventRecord(2, { type: "message_end", message }),
		);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(3, { type: "turn_end", message }),
		);

		expect(p.usageTotals).toEqual({ tokens: 15, cost: 0.001 });
		expect(p.attempts.get("run-1")?.tokens).toEqual({
			total: 15,
			cost: 0.001,
			input: 0,
			output: 0,
		});
	});

	test("humanizes streaming tool-call arguments instead of showing raw JSON", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(2, {
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
			agentProjectionEventRecord(2, {
				type: "message_update",
				assistantMessageEvent: {
					type: "text_delta",
					delta: "checking cache",
					partial: { content: [{ type: "text", text: "checking cache" }] },
				},
			}),
		);
		p = reduceRecord(p, agentProjectionEventRecord(3, { type: "message_end" }));
		p = reduceRecord(p, agentProjectionEventRecord(4, { type: "turn_start" }));
		expect(dashboardModelFrom(p).work[0]?.activity).toBe(
			"writing: checking cache",
		);
	});

	test("keeps last tool summary across lifecycle events", () => {
		let p = emptyProjection("default", "workflow");
		p = reduceRecord(p, started);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(2, {
				type: "tool_execution_start",
				toolCallId: "tool-1",
				toolName: "bash",
				args: { command: "bun run check" },
			}),
		);
		p = reduceRecord(
			p,
			agentProjectionEventRecord(3, {
				type: "tool_execution_end",
				toolCallId: "tool-1",
			}),
		);
		p = reduceRecord(p, agentProjectionEventRecord(4, { type: "turn_start" }));
		expect(dashboardModelFrom(p).work[0]?.activity).toBe("bun run check");
	});
});
