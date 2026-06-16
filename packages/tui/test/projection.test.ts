import { describe, expect, test } from "bun:test";
import {
	plotProtocolVersion,
	type PlotServerRecord,
} from "@plot/control/protocol";
import {
	applySnapshot,
	emptyProjection,
	reduceRecord,
} from "@plot/control/projection";

const eventRecord = (
	sequence: number,
	type: string,
	payload: unknown,
): PlotServerRecord => ({
	protocol: plotProtocolVersion,
	kind: "session_event",
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

const plotAgentEvent = (sequence: number, event: Record<string, unknown>) =>
	eventRecord(sequence, String(event["type"]), event);

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

// Wrap a verbatim pi-mono AgentSessionEvent the way plot-session.ts does.
const agentRunEvent = (
	sequence: number,
	event: Record<string, unknown>,
	workKey = "source:item:42",
) =>
	eventRecord(sequence, "agent_run_event", {
		sourceId: "extension:worker",
		runId: "run-1",
		workKey,
		subject: "source:item:42",
		eventType: String(event["type"]),
		event,
	});

// Real builtin-tool events: start carries toolName + args; end carries
// toolName + result + isError (no args).
const toolStart = (
	sequence: number,
	toolName: string,
	args: Record<string, unknown>,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{
			type: "tool_execution_start",
			toolName,
			args,
			toolCallId: `tc-${sequence}`,
		},
		workKey,
	);

const toolUpdate = (
	sequence: number,
	toolName: string,
	args: Record<string, unknown>,
	partialResult: unknown = {},
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{ type: "tool_execution_update", toolName, args, partialResult },
		workKey,
	);

const toolEnd = (
	sequence: number,
	toolName: string,
	isError = false,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{ type: "tool_execution_end", toolName, result: {}, isError },
		workKey,
	);

const bashStart = (
	sequence: number,
	command: string,
	workKey = "source:item:42",
) => toolStart(sequence, "bash", { command }, workKey);

const turnStart = (sequence: number, workKey = "source:item:42") =>
	agentRunEvent(sequence, { type: "turn_start" }, workKey);

const messageDelta = (
	sequence: number,
	delta: string,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: { type: "text_delta", delta },
		},
		workKey,
	);

describe("Plot TUI projection", () => {
	test("classifies operator stage from the tool kind, not prose", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "git diff --stat"));
		expect(projection.running.get("source:item:42")?.stage).toBe("working");
		expect(projection.running.get("source:item:42")?.activityKind).toBe("run");

		projection = reduceRecord(projection, bashStart(3, "bun run check"));
		expect(projection.running.get("source:item:42")?.stage).toBe("verifying");
		expect(projection.running.get("source:item:42")?.check).toBe("running");

		projection = reduceRecord(projection, bashStart(4, "gh pr review 42"));
		expect(projection.running.get("source:item:42")?.stage).toBe("finishing");

		// Blocked is an operator-attention signal, not a string match.
		projection = reduceRecord(
			projection,
			plotAgentEvent(5, {
				type: "operator_actions_declared",
				workKey: "source:item:42",
				actions: [{ id: "approve", label: "Approve" }],
			}),
		);
		expect(projection.running.get("source:item:42")?.stage).toBe("blocked");
	});

	test("derives check pass/fail from tool_execution_end isError", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "bun run check"));
		expect(projection.running.get("source:item:42")?.check).toBe("running");
		projection = reduceRecord(projection, toolEnd(3, "bash", true));
		expect(projection.running.get("source:item:42")?.check).toBe("failed");
		expect(projection.running.get("source:item:42")?.stage).toBe("failed");
	});

	test("coalesces consecutive same-kind tools into one phase with a count", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			toolStart(2, "read", { path: "a.ts" }),
		);
		projection = reduceRecord(
			projection,
			toolStart(3, "read", { path: "b.ts" }),
		);
		projection = reduceRecord(
			projection,
			toolStart(4, "read", { path: "c.ts" }),
		);
		projection = reduceRecord(
			projection,
			toolStart(5, "edit", { path: "a.ts" }),
		);

		const phases = projection.running.get("source:item:42")?.phases ?? [];
		expect(phases.map((p) => `${p.kind}:${p.count}`)).toEqual([
			"read:3",
			"edit:1",
		]);
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
		projection = reduceRecord(projection, bashStart(2, "bun run check"));
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
		projection = reduceRecord(projection, turnStart(2));
		projection = reduceRecord(projection, messageDelta(3, "partial"));
		projection = reduceRecord(
			projection,
			toolUpdate(4, "bash", { command: "gh pr diff 1532" }),
		);
		projection = reduceRecord(projection, turnStart(5));

		const work = projection.running.get("source:item:42");
		expect(work?.turnCount).toBe(2);
		expect(work?.eventCount).toBe(4);
		expect(work?.messageCount).toBe(1);
		expect(work?.toolUpdateCount).toBe(1);
	});

	test("surfaces streaming deltas as the live activity line", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			messageDelta(2, "I am checking the failing p3-serve build now."),
		);

		let work = projection.running.get("source:item:42");
		expect(work?.activity).toBe(
			"I am checking the failing p3-serve build now.",
		);
		expect(work?.streaming).toBe(true);
		expect(work?.lastMeaningful).toBe("started");
		expect(work?.messageCount).toBe(1);

		projection = reduceRecord(
			projection,
			toolUpdate(3, "bash", { command: "yarn install" }),
		);
		work = projection.running.get("source:item:42");
		expect(work?.activity).toBe("Running yarn install");
		expect(work?.streaming).toBe(true);
		expect(work?.toolUpdateCount).toBe(1);
	});

	test("ignores tool-result usage so totals stay scoped to Agent Runs", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			toolUpdate(
				2,
				"grep",
				{ pattern: "todo" },
				{
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
			),
		);

		const work = projection.running.get("source:item:42");
		expect(work?.tokens).toBeUndefined();
		expect(projection.usageTotals.tokens).toBe(0);
		expect(projection.usageTotals.cost).toBeUndefined();
	});

	test("records one past-tense timeline entry per completed tool", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "gh pr diff 1532"));
		// in-progress shows in the live line, not the timeline
		expect(projection.running.get("source:item:42")?.activity).toBe(
			"Running gh pr diff 1532",
		);
		projection = reduceRecord(
			projection,
			toolUpdate(3, "bash", { command: "gh pr diff 1532" }),
		);
		projection = reduceRecord(projection, toolEnd(4, "bash"));

		const work = projection.running.get("source:item:42");
		expect(work?.timeline.map((entry) => entry.text)).toEqual([
			"Ran gh pr diff 1532",
			"work started",
		]);
		expect(work?.timeline.every((entry) => entry.atMs > 0)).toBe(true);
		expect(projection.debugEvents[0]).toContain("tool_execution_end");
	});

	test("late agent events do not resurrect completed work", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			plotAgentEvent(2, {
				type: "work_completed",
				completion: {
					workKey: "source:item:42",
					status: "succeeded",
				},
			}),
		);
		projection = reduceRecord(
			projection,
			messageDelta(3, "late message after completion"),
		);

		expect(projection.running.has("source:item:42")).toBe(false);
		expect(projection.completed[0]?.workKey).toBe("source:item:42");
	});

	test("agent events cannot create running rows without work_started", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			messageDelta(1, "message before lifecycle"),
		);

		expect(projection.running.size).toBe(0);
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
