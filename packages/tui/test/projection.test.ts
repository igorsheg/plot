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
	timestamp = "2026-06-15T00:00:00.000Z",
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
		timestamp,
		type,
		payload,
	},
});

const plotAgentEvent = (sequence: number, event: Record<string, unknown>) =>
	eventRecord(sequence, String(event["type"]), event);

const workObserved = (sequence: number, status = "pending") =>
	eventRecord(sequence, "work_observed", {
		work: {
			workKey: "source:item:42",
			sourceId: "extension:worker",
			status,
			display: { primary: "#42", title: "Fix checkout totals" },
		},
	});

const workRemoved = (sequence: number) =>
	eventRecord(sequence, "work_removed", { workKey: "source:item:42" });

const workStarted = (
	sequence: number,
	workKey = "source:item:42",
	labels: readonly string[] = [],
) =>
	plotAgentEvent(sequence, {
		type: "attempt_started",
		run: {
			runId: "run-1",
			sourceId: "extension:worker",
			workKey,
			subject: "source:item:42",
			display: {
				primary: "#42",
				title: "Fix checkout totals",
				url: "https://example.com/pr/42",
				...(labels.length === 0 ? {} : { labels }),
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

const toolEndWithId = (
	sequence: number,
	toolName: string,
	toolCallId: string,
	isError = false,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{ type: "tool_execution_end", toolName, toolCallId, result: {}, isError },
		workKey,
	);

const toolUpdateWithId = (
	sequence: number,
	toolName: string,
	toolCallId: string,
	args: Record<string, unknown>,
	partialResult: unknown,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{
			type: "tool_execution_update",
			toolName,
			toolCallId,
			args,
			partialResult,
		},
		workKey,
	);

const toolStartWithId = (
	sequence: number,
	toolName: string,
	toolCallId: string,
	args: Record<string, unknown>,
	workKey = "source:item:42",
) =>
	agentRunEvent(
		sequence,
		{ type: "tool_execution_start", toolName, args, toolCallId },
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

const thinkingDelta = (sequence: number, delta: string) =>
	agentRunEvent(sequence, {
		type: "message_update",
		message: { role: "assistant", content: [] },
		assistantMessageEvent: { type: "thinking_delta", delta },
	});

const toolCallPartial = (
	sequence: number,
	toolName: string,
	toolCallId: string,
	args: Record<string, unknown>,
) =>
	agentRunEvent(sequence, {
		type: "message_update",
		message: { role: "assistant", content: [] },
		assistantMessageEvent: {
			type: "toolcall_delta",
			delta: JSON.stringify(args),
			partial: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: toolCallId, name: toolName, arguments: args },
				],
			},
		},
	});

const messagePartial = (sequence: number, delta: string, partial: string) =>
	agentRunEvent(sequence, {
		type: "message_update",
		message: { role: "assistant", content: [] },
		assistantMessageEvent: {
			type: "text_delta",
			delta,
			partial: {
				role: "assistant",
				content: [{ type: "text", text: partial }],
			},
		},
	});

const mixedMessagePartial = (
	sequence: number,
	thinking: string,
	message: string,
) =>
	agentRunEvent(sequence, {
		type: "message_update",
		message: { role: "assistant", content: [] },
		assistantMessageEvent: {
			type: "text_delta",
			delta: message,
			partial: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking },
					{ type: "text", text: message },
				],
			},
		},
	});

const messageEndWithUsage = (sequence: number) =>
	agentRunEvent(sequence, {
		type: "message_end",
		message: {
			role: "assistant",
			content: [],
			usage: {
				input: 1000,
				output: 200,
				totalTokens: 1200,
				cost: { total: 0.42 },
			},
		},
	});

describe("Plot TUI projection", () => {
	test("canonical work events own visible work", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workObserved(1, "blocked"));
		expect(projection.work.get("source:item:42")?.status).toBe("blocked");
		projection = reduceRecord(projection, workRemoved(2));
		expect(projection.work.has("source:item:42")).toBe(false);
	});

	test("classifies operator stage from the tool kind, not prose", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "git diff --stat"));
		expect(projection.attempts.get("run-1")?.stage).toBe("working");
		expect(projection.attempts.get("run-1")?.activityKind).toBe("run");

		projection = reduceRecord(projection, bashStart(3, "bun run check"));
		expect(projection.attempts.get("run-1")?.stage).toBe("verifying");
		expect(projection.attempts.get("run-1")?.check).toBe("running");

		projection = reduceRecord(projection, bashStart(4, "gh pr review 42"));
		expect(projection.attempts.get("run-1")?.stage).toBe("finishing");

		// Blocked is source work state; attempt stage stays about agent activity.
		projection = applySnapshot(projection, {
			snapshot: {
				work: new Map([
					[
						"source:item:42",
						{
							workKey: "source:item:42",
							sourceId: "extension:worker",
							status: "blocked",
							display: { primary: "#42", title: "Fix checkout totals" },
							blockedReason: "waiting for approval",
							operatorActions: [{ id: "approve", label: "Approve" }],
							currentRunId: "run-1",
						},
					],
				]),
				running: new Map([
					[
						"source:item:42",
						{
							runId: "run-1",
							sourceId: "extension:worker",
							workKey: "source:item:42",
						},
					],
				]),
			},
		});
		expect(projection.work.get("source:item:42")?.status).toBe("blocked");
		expect(projection.attempts.get("run-1")?.stage).toBe("finishing");
	});

	test("derives check pass/fail from tool_execution_end isError", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "bun run check"));
		expect(projection.attempts.get("run-1")?.check).toBe("running");
		projection = reduceRecord(projection, toolEnd(3, "bash", true));
		expect(projection.attempts.get("run-1")?.check).toBe("failed");
		expect(projection.attempts.get("run-1")?.stage).toBe("failed");
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

		const phases = projection.attempts.get("run-1")?.phases ?? [];
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
		expect(projection.status).toBe("running");
		expect(projection.activity[0]?.text).toContain("tick #7 found 1");
	});

	test("replays scheduled wakes from Session History time", () => {
		const timestamp = "2026-06-15T00:00:00.000Z";
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			eventRecord(
				1,
				"wake_scheduled",
				{ delayMs: 5_000, reason: "retry", workKey: "source:item:42" },
				timestamp,
			),
		);

		expect(projection.scheduledWakes).toEqual([
			{
				dueAtMs: Date.parse(timestamp) + 5_000,
				delayMs: 5_000,
				reason: "retry",
				workKey: "source:item:42",
			},
		]);
	});

	test("drops scheduled wakes when later history makes them stale", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			eventRecord(1, "wake_scheduled", {
				delayMs: 1_000,
				workKey: "source:item:42",
			}),
		);
		projection = reduceRecord(
			projection,
			eventRecord(2, "tick_started", { tickId: 2 }, "2026-06-15T00:00:02.000Z"),
		);
		expect(projection.scheduledWakes).toEqual([]);

		projection = reduceRecord(
			projection,
			eventRecord(3, "wake_scheduled", {
				delayMs: 60_000,
				workKey: "source:item:42",
			}),
		);
		projection = reduceRecord(
			projection,
			eventRecord(4, "attempt_completed", {
				completion: { workKey: "source:item:42", status: "succeeded" },
			}),
		);
		expect(projection.scheduledWakes).toEqual([]);
	});

	test("feeds fleet activity from work lifecycle, not raw event spam", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			workStarted(1, "source:item:42", ["phase:post", "incremental"]),
		);
		projection = reduceRecord(projection, bashStart(2, "bun run check"));
		projection = reduceRecord(projection, messageEndWithUsage(3));
		projection = reduceRecord(
			projection,
			plotAgentEvent(4, {
				type: "attempt_completed",
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
			runId: "run-1",
			label: "#42 Fix checkout totals",
			status: "succeeded",
			url: "https://example.com/pr/42",
			labels: ["phase:post", "incremental"],
			tokens: { input: 1000, output: 200, total: 1200, cost: 0.42 },
		});
		expect(projection.completed[0]?.durationMs).toBeGreaterThanOrEqual(0);
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

		const work = projection.attempts.get("run-1");
		expect(work?.turnCount).toBe(2);
		expect(work?.eventCount).toBe(4);
		expect(work?.messageCount).toBe(1);
		expect(work?.toolUpdateCount).toBe(1);
	});

	test("accumulates assistant partial text instead of replacing with each delta", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, messagePartial(2, "hello", "hello"));
		projection = reduceRecord(
			projection,
			messagePartial(3, " world", "hello world"),
		);
		projection = reduceRecord(
			projection,
			messagePartial(4, "!", "hello world!"),
		);

		const work = projection.attempts.get("run-1");
		expect(work?.activity).toBe("hello world!");
		expect(work?.streams.message).toBe("hello world!");
		expect(work?.streaming).toBe(true);
		expect(work?.messageCount).toBe(3);
	});

	test("keeps thinking and prose lanes separate and replaces partials", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			mixedMessagePartial(2, "**Inspecting clone progress**", "I need"),
		);
		projection = reduceRecord(
			projection,
			mixedMessagePartial(
				3,
				"**Inspecting clone progress**",
				"I need the clone to finish",
			),
		);

		const work = projection.attempts.get("run-1");
		expect(work?.activity).toBe("I need the clone to finish");
		expect(work?.streams.thinking).toBe("Inspecting clone progress");
		expect(work?.streams.message).toBe("I need the clone to finish");
		expect(work?.activity).not.toContain("Inspecting clone progressI need");
	});

	test("routes thinking deltas without partials to the thinking lane", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, thinkingDelta(2, "checking context"));

		const work = projection.attempts.get("run-1");
		expect(work?.streams.thinking).toBe("checking context");
		expect(work?.streams.message).toBeUndefined();
		expect(work?.activityKind).toBe("think");
	});

	test("surfaces tool calls and partial tool output in the tool lane", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			toolCallPartial(2, "bash", "tc-check", { command: "bun run check" }),
		);

		let work = projection.attempts.get("run-1");
		expect(work?.streams.tool).toBe("Preparing bun run check");
		expect(work?.activityKind).toBe("test");

		projection = reduceRecord(
			projection,
			toolStartWithId(3, "bash", "tc-check", { command: "bun run check" }),
		);
		projection = reduceRecord(
			projection,
			toolUpdateWithId(
				4,
				"bash",
				"tc-check",
				{ command: "bun run check" },
				{ content: [{ type: "text", text: "one\ntwo" }] },
			),
		);

		work = projection.attempts.get("run-1");
		expect(work?.streams.tool).toBe("Running bun run check · two");
		expect(work?.activity).toBe("Running bun run check · two");
	});

	test("attributes parallel tool completions by toolCallId", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			toolStartWithId(2, "read", "tc-a", { path: "a.ts" }),
		);
		projection = reduceRecord(
			projection,
			toolStartWithId(3, "read", "tc-b", { path: "b.ts" }),
		);
		projection = reduceRecord(projection, toolEndWithId(4, "read", "tc-a"));

		let work = projection.attempts.get("run-1");
		expect(work?.timeline[0]?.text).toBe("Read a.ts");
		expect(work?.activeTools?.has("tc-b")).toBe(true);

		projection = reduceRecord(projection, toolEndWithId(5, "read", "tc-b"));
		work = projection.attempts.get("run-1");
		expect(work?.timeline.map((entry) => entry.text)).toEqual([
			"Read b.ts",
			"Read a.ts",
			"attempt started",
		]);
		expect(work?.activeTools).toBeUndefined();
	});

	test("surfaces streaming deltas as the live activity line", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(
			projection,
			messageDelta(2, "I am checking the failing p3-serve build now."),
		);

		let work = projection.attempts.get("run-1");
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
		work = projection.attempts.get("run-1");
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

		const work = projection.attempts.get("run-1");
		expect(work?.tokens).toBeUndefined();
		expect(projection.usageTotals.tokens).toBe(0);
		expect(projection.usageTotals.cost).toBeUndefined();
	});

	test("records one past-tense timeline entry per completed tool", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1));
		projection = reduceRecord(projection, bashStart(2, "gh pr diff 1532"));
		// in-progress shows in the live line, not the timeline
		expect(projection.attempts.get("run-1")?.activity).toBe(
			"Running gh pr diff 1532",
		);
		projection = reduceRecord(
			projection,
			toolUpdate(3, "bash", { command: "gh pr diff 1532" }),
		);
		projection = reduceRecord(projection, toolEnd(4, "bash"));

		const work = projection.attempts.get("run-1");
		expect(work?.timeline.map((entry) => entry.text)).toEqual([
			"Ran gh pr diff 1532",
			"attempt started",
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
				type: "attempt_completed",
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

		expect(projection.attempts.has("run-1")).toBe(false);
		expect(projection.completed[0]?.workKey).toBe("source:item:42");
	});

	test("agent events cannot create running rows without attempt_started", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(
			projection,
			messageDelta(1, "message before lifecycle"),
		);

		expect(projection.attempts.size).toBe(0);
	});

	test("snapshot repairs visible work and attempts by key", () => {
		let projection = emptyProjection("default", "workflow");
		projection = reduceRecord(projection, workStarted(1, "source:item:1"));
		expect(projection.work.has("source:item:1")).toBe(true);
		expect(projection.attempts.has("run-1")).toBe(true);

		projection = applySnapshot(projection, {
			snapshot: {
				work: new Map([
					[
						"source:item:2",
						{
							workKey: "source:item:2",
							sourceId: "extension:worker",
							status: "running",
							display: { title: "source:item:2" },
							currentRunId: "run-2",
						},
					],
				]),
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

		expect(projection.work.has("source:item:1")).toBe(false);
		expect(projection.work.has("source:item:2")).toBe(true);
		expect(projection.status).toBe("running");
		expect(projection.attempts.has("run-1")).toBe(false);
		expect(projection.attempts.has("run-2")).toBe(true);
	});
});
