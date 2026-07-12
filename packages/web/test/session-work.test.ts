import { expect, test } from "bun:test";
import type {
	SerializedDashboardProjection,
	TimelineEntry,
} from "@plot/projection";
import { fetchAttemptTranscript, parseTranscript } from "../src/data/api.js";
import { $selectedProjection } from "../src/app/projection-store.js";
import {
	buildAttention,
	buildMotion,
	buildSettled,
	decisionCount,
	parseOperatorActions,
	verifyingLine,
} from "../src/components/session-work/view-model.js";
import {
	buildDetail,
	capTimeline,
	formatTokens,
	openableRefs,
	refEquals,
	settledKey,
	stepRef,
	type DetailRef,
} from "../src/components/session-work/detail-view-model.js";
import {
	$detailView,
	$openDetail,
} from "../src/components/session-work/detail-store.js";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../src/lib/relative-time.js";

const NOW = 1_000_000;

test("detail open ref survives transient unresolved projection state", () => {
	const ref: DetailRef = { kind: "work", workKey: "missing" };
	$openDetail.set(ref);
	$selectedProjection.set(undefined);

	expect($detailView.get()).toBeUndefined();
	expect($openDetail.get()).toEqual(ref);

	$openDetail.set(undefined);
});
const workRef = (workKey: string): DetailRef => ({ kind: "work", workKey });

const work = (
	key: string,
	overrides: Partial<SerializedDashboardProjection["work"][string]>,
): SerializedDashboardProjection["work"][string] => ({
	workKey: key,
	sourceId: "source",
	title: key,
	labels: [],
	status: "running",
	...overrides,
});

const attempt = (
	runId: string,
	workKey: string,
	overrides: Partial<SerializedDashboardProjection["attempts"][string]>,
): SerializedDashboardProjection["attempts"][string] => ({
	runId,
	workKey,
	sourceId: "source",
	stage: "working",
	startedAtSeq: 1,
	lastEventSeq: 2,
	turnCount: 1,
	eventCount: 1,
	meaningfulCount: 1,
	toolUpdateCount: 0,
	messageCount: 0,
	activity: "working",
	activityKind: "edit",
	streaming: false,
	lastDisplay: "working",
	check: "not-run",
	commands: [],
	observations: [],
	streams: {},
	phases: [],
	timeline: [],
	...overrides,
});

const projection = (
	overrides: Partial<SerializedDashboardProjection>,
): SerializedDashboardProjection => ({
	sessionId: "session-1",
	workflowName: "Web rebuild",
	status: "running",
	frontier: 1,
	runtime: { cwd: "/repo", cwdName: "repo", skills: [], skillPaths: [] },
	usageTotals: { tokens: 0 },
	tokenSamples: [],
	sources: {},
	work: {},
	attempts: {},
	completed: [],
	diagnostics: [],
	scheduledWakes: [],
	activity: [],
	debugEvents: [],
	...overrides,
});

const source = (
	overrides: Partial<SerializedDashboardProjection["sources"][string]> & {
		sourceId: string;
	},
): SerializedDashboardProjection["sources"][string] => ({
	label: overrides.sourceId,
	readiness: "action-required",
	requirements: [],
	diagnostics: [],
	...overrides,
});

test("buildAttention maps an action-required source to an openable item", () => {
	const attention = buildAttention(
		projection({
			sources: {
				"extension:jira": source({
					sourceId: "extension:jira",
					label: "Wix Jira",
					readiness: "action-required",
					requirements: [
						{
							id: "wix-mcp",
							label: "Wix MCP",
							status: "action-required",
							message: "Connect Wix MCP",
							actions: [{ id: "connect", label: "Connect Wix MCP" }],
						},
					],
				}),
			},
		}),
	);

	// The river item is a status frame: no requirementId, no actions — those
	// move to the drawer. The message reads as guidance, not an error.
	expect(attention).toContainEqual({
		kind: "source",
		key: "source:extension:jira",
		sourceId: "extension:jira",
		title: "Wix Jira",
		status: "action-required",
		actionStatus: undefined,
		message: "Connect Wix MCP",
		progress: undefined,
	});
});

test("buildAttention suppresses checking and ready sources", () => {
	const attention = buildAttention(
		projection({
			sources: {
				a: source({ sourceId: "a", readiness: "checking" }),
				b: source({ sourceId: "b", readiness: "ready" }),
			},
		}),
	);
	expect(attention).toEqual([]);
});

test("buildAttention keeps a running action in the source item", () => {
	const attention = buildAttention(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					label: "Wix",
					readiness: "action-required",
					requirements: [
						{ id: "mcp", label: "MCP", status: "action-required" },
					],
					action: {
						actionRunId: "run-1",
						requirementId: "mcp",
						actionId: "connect",
						status: "running",
						progress: "Waiting for authorization…",
					},
				}),
			},
		}),
	);
	expect(attention[0]).toMatchObject({
		kind: "source",
		status: "action-required",
		actionStatus: "running",
		progress: "Waiting for authorization…",
	});
});

test("buildAttention surfaces a failed action's progress", () => {
	const attention = buildAttention(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					readiness: "action-required",
					requirements: [
						{ id: "mcp", label: "MCP", status: "action-required" },
					],
					action: {
						actionRunId: "run-1",
						requirementId: "mcp",
						actionId: "connect",
						status: "failed",
						progress: "Authorization denied",
					},
				}),
			},
		}),
	);
	expect(attention[0]).toMatchObject({
		kind: "source",
		actionStatus: "failed",
		progress: "Authorization denied",
	});
});

test("buildAttention treats a cancelled action as no action in flight", () => {
	const attention = buildAttention(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					readiness: "action-required",
					action: {
						actionRunId: "run-1",
						requirementId: "mcp",
						actionId: "connect",
						status: "cancelled",
					},
				}),
			},
		}),
	);
	expect(attention[0]).toMatchObject({
		kind: "source",
		actionStatus: undefined,
		progress: undefined,
	});
});

test("buildAttention keeps an unavailable source muted", () => {
	const attention = buildAttention(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					readiness: "unavailable",
					message: "Wix MCP unreachable — retrying",
				}),
			},
		}),
	);
	expect(attention[0]).toMatchObject({
		kind: "source",
		status: "unavailable",
		actionStatus: undefined,
		message: "Wix MCP unreachable — retrying",
	});
});

test("buildAttention orders sources before work decisions", () => {
	const attention = buildAttention(
		projection({
			sources: {
				w: source({ sourceId: "w", readiness: "action-required" }),
			},
			work: {
				pick: work("pick", { status: "blocked", blockedReason: "why" }),
			},
		}),
	);
	expect(attention.map((item) => item.kind)).toEqual(["source", "decision"]);
});

test("parseOperatorActions parses the real OperatorAction shape", () => {
	const actions = parseOperatorActions([
		{
			id: "approve",
			label: "Approve",
			tone: "secondary",
			disabledReason: "CI running",
			requiresComment: true,
			confirm: { title: "Really approve?", message: "irreversible" },
		},
	]);
	expect(actions).toEqual([
		{
			id: "approve",
			label: "Approve",
			tone: "secondary",
			disabledReason: "CI running",
			requiresComment: true,
			confirmTitle: "Really approve?",
		},
	]);
});

test("parseOperatorActions skips junk entries and applies defaults", () => {
	const actions = parseOperatorActions([
		null,
		42,
		"nope",
		{ label: "missing id" },
		{ id: "missing-label" },
		{ id: "ok", label: "Ok", tone: "shout" },
	]);
	expect(actions).toEqual([
		{
			id: "ok",
			label: "Ok",
			tone: "primary",
			disabledReason: undefined,
			requiresComment: false,
			confirmTitle: undefined,
		},
	]);
});

test("parseOperatorActions handles undefined", () => {
	expect(parseOperatorActions(undefined)).toEqual([]);
});

test("buildAttention turns blocked work into a decision with reason", () => {
	const attention = buildAttention(
		projection({
			work: {
				pick: work("pick", {
					status: "blocked",
					blockedReason: "Need operator decision",
				}),
			},
		}),
	);
	expect(attention).toEqual([
		{
			kind: "decision",
			key: "pick",
			workKey: "pick",
			sourceId: "source",
			title: "pick",
			sinceMs: undefined,
			reason: "Need operator decision",
			actions: [],
		},
	]);
});

test("operator actions on waiting work are neutral held affordances", () => {
	const value = projection({
		work: {
			review: work("review", {
				status: "waiting",
				blockedReason: "reviewed at this head",
				operatorActions: [{ id: "review-again", label: "Review again" }],
			}),
		},
	});

	expect(buildAttention(value)).toEqual([]);
	expect(buildMotion(value)).toEqual([
		{
			kind: "held",
			key: "review",
			workKey: "review",
			sourceId: "source",
			title: "review",
			sub: undefined,
			reason: "reviewed at this head",
			actions: [
				{
					id: "review-again",
					label: "Review again",
					tone: "primary",
					disabledReason: undefined,
					requiresComment: false,
					confirmTitle: undefined,
				},
			],
		},
	]);
});

test("buildAttention leaves attempt failures to diagnostics and history", () => {
	const attention = buildAttention(
		projection({
			work: {
				pending: work("pending", { status: "pending" }),
			},
			diagnostics: ["work run failed"],
		}),
	);
	expect(attention).toEqual([
		{ kind: "diagnostic", key: "diagnostic:0", text: "work run failed" },
	]);
});

test("buildAttention caps diagnostics at 3 after decisions and failures", () => {
	const attention = buildAttention(
		projection({
			work: {
				pick: work("pick", { status: "blocked", blockedReason: "why" }),
			},
			diagnostics: ["one", "two", "three", "four"],
		}),
	);
	expect(attention.map((item) => item.kind)).toEqual([
		"decision",
		"diagnostic",
		"diagnostic",
		"diagnostic",
	]);
	expect(
		attention.flatMap((item) =>
			item.kind === "diagnostic" ? [item.text] : [],
		),
	).toEqual(["one", "two", "three"]);
});

test("buildAttention orders decisions oldest-first, unknown last", () => {
	const attention = buildAttention(
		projection({
			work: {
				newer: work("newer", {
					status: "blocked",
					blockedReason: "b",
					currentRunId: "run-new",
				}),
				unknown: work("unknown", { status: "blocked", blockedReason: "c" }),
				older: work("older", {
					status: "blocked",
					blockedReason: "a",
					currentRunId: "run-old",
				}),
			},
			attempts: {
				"run-new": attempt("run-new", "newer", { lastEventAtMs: 2_000 }),
				"run-old": attempt("run-old", "older", { lastEventAtMs: 1_000 }),
			},
		}),
	);
	expect(attention.map((item) => item.key)).toEqual([
		"older",
		"newer",
		"unknown",
	]);
});

test("buildMotion puts active work before queued work before held work", () => {
	const motion = buildMotion(
		projection({
			work: {
				second: work("second", { status: "running", currentRunId: "run-2" }),
				queuedItem: work("a-queued", { status: "pending" }),
				heldItem: work("b-held", {
					status: "waiting",
					blockedReason: "draft pull request",
				}),
				first: work("first", { status: "draining", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "first", { startedAtMs: 1_000 }),
				"run-2": attempt("run-2", "second", { startedAtMs: 5_000 }),
			},
		}),
	);
	expect(motion.map((item) => [item.kind, item.key])).toEqual([
		["active", "first"],
		["active", "second"],
		["queued", "a-queued"],
		["held", "b-held"],
	]);
});

test("buildMotion resolves the earliest scheduled wake for a queued workKey", () => {
	const motion = buildMotion(
		projection({
			work: {
				sleeper: work("sleeper", {
					status: "pending",
					subtitle: "Waiting on CI",
				}),
			},
			scheduledWakes: [
				{ dueAtMs: 9_000, delayMs: 1 },
				{ dueAtMs: 8_000, delayMs: 1, workKey: "sleeper" },
				{ dueAtMs: 3_000, delayMs: 1, workKey: "sleeper" },
				{ dueAtMs: 5_000, delayMs: 1, workKey: "other" },
			],
		}),
	);
	expect(motion).toEqual([
		{
			kind: "queued",
			key: "sleeper",
			title: "sleeper",
			sub: "Waiting on CI",
			wakeDueAtMs: 3_000,
		},
	]);
});

test("buildMotion resolves the live line through the stream chain", () => {
	const motion = buildMotion(
		projection({
			work: {
				busy: work("busy", { status: "running", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "busy", {
					streams: { tool: "Reading session-dock.tsx", message: "hello" },
					streaming: true,
					stage: "verifying",
				}),
			},
		}),
	);
	const item = motion[0];
	expect(item?.kind).toBe("active");
	if (item?.kind === "active") {
		// Tool wins the chain and is NOT markdown — tagged plain.
		expect(item.line).toEqual({ text: "Reading session-dock.tsx", llm: false });
		expect(item.streaming).toBe(true);
		expect(item.verifying).toBe(true);
	}
});

test("buildMotion keeps lastDisplay visible when streams are between chunks", () => {
	const motion = buildMotion(
		projection({
			work: {
				busy: work("busy", { status: "running", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "busy", {
					activity: "working",
					lastDisplay: "Reading session-work.tsx",
					streams: {},
				}),
			},
		}),
	);
	const item = motion[0];
	expect(item?.kind).toBe("active");
	if (item?.kind === "active") {
		expect(item.line).toEqual({
			text: "Reading session-work.tsx",
			llm: false,
		});
	}
});

test("buildMotion tags a message stream as LLM-authored", () => {
	const motion = buildMotion(
		projection({
			work: {
				busy: work("busy", { status: "running", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "busy", {
					streams: { message: "**Done** — see `main.ts`" },
				}),
			},
		}),
	);
	const item = motion[0];
	expect(item?.kind).toBe("active");
	if (item?.kind === "active") {
		expect(item.line).toEqual({ text: "**Done** — see `main.ts`", llm: true });
	}
});

test("buildMotion tags a thinking-only line as LLM and a subtitle as plain", () => {
	const thinking = buildMotion(
		projection({
			work: { a: work("a", { status: "running", currentRunId: "ra" }) },
			attempts: {
				ra: attempt("ra", "a", { streams: { thinking: "reasoning…" } }),
			},
		}),
	)[0];
	expect(thinking?.kind === "active" && thinking.line).toEqual({
		text: "reasoning…",
		llm: true,
	});

	const subtitle = buildMotion(
		projection({
			work: {
				b: work("b", {
					status: "running",
					subtitle: "queued behind CI",
				}),
			},
		}),
	)[0];
	expect(subtitle?.kind === "active" && subtitle.line).toEqual({
		text: "queued behind CI",
		llm: false,
	});
});

test("buildSettled carries the LLM-authored message verbatim for the streamdown path", () => {
	const settled = buildSettled(
		projection({
			completed: [
				{
					workKey: "w",
					runId: "r",
					label: "w",
					status: "succeeded",
					message: "Shipped `Button` — 12 tests pass",
					atMs: 10,
				},
			],
		}),
	);
	// Settled messages are always LLM-authored; the row renders them via
	// StreamedLine, the drawer via StreamedProse — the model preserves the text.
	expect(settled[0]?.message).toBe("Shipped `Button` — 12 tests pass");
	expect(settled[0]?.failed).toBe(false);
});

test("buildSettled caps at 7 and maps failed statuses", () => {
	const completed = Array.from({ length: 9 }, (_, i) => ({
		workKey: `done-${i}`,
		label: `done-${i}`,
		status: i === 1 ? "failed" : i === 2 ? "timed_out" : "succeeded",
		message: `message ${i}`,
		atMs: 100 - i,
		durationMs: i === 0 ? 41_000 : undefined,
	}));
	const settled = buildSettled(projection({ completed }));
	expect(settled).toHaveLength(7);
	expect(settled.map((item) => item.failed)).toEqual([
		false,
		true,
		true,
		false,
		false,
		false,
		false,
	]);
	expect(settled[0]?.durationMs).toBe(41_000);
	expect(settled[1]?.durationMs).toBeUndefined();
});

test("decisionCount counts only decisions", () => {
	const attention = buildAttention(
		projection({
			work: {
				one: work("one", { status: "blocked", blockedReason: "a" }),
				two: work("two", { status: "pending" }),
			},
			diagnostics: ["noise"],
		}),
	);
	expect(decisionCount(attention)).toBe(1);
});

test("verifyingLine prefixes without doubling", () => {
	expect(verifyingLine("bun test test/button.test.tsx")).toBe(
		"Verifying — bun test test/button.test.tsx",
	);
	expect(verifyingLine("Verifying — already prefixed")).toBe(
		"Verifying — already prefixed",
	);
	expect(verifyingLine("Verifying build output")).toBe(
		"Verifying build output",
	);
});

test("formatShortAge clamps to 1s and crosses units coarsely", () => {
	expect(formatShortAge(0)).toBe("1s");
	expect(formatShortAge(-500)).toBe("1s");
	expect(formatShortAge(4_000)).toBe("4s");
	expect(formatShortAge(44_000)).toBe("44s");
	expect(formatShortAge(59_000)).toBe("1m");
	expect(formatShortAge(44 * 60_000)).toBe("44m");
	expect(formatShortAge(45 * 60_000)).toBe("1h");
	expect(formatShortAge(21 * 3_600_000)).toBe("21h");
	expect(formatShortAge(22 * 3_600_000)).toBe("1d");
});

test("formatDuration renders seconds, minutes, and mixed hours", () => {
	expect(formatDuration(41_000)).toBe("41s");
	expect(formatDuration(3 * 60_000)).toBe("3m");
	expect(formatDuration(64 * 60_000)).toBe("1h 4m");
	expect(formatDuration(120 * 60_000)).toBe("2h");
	expect(formatDuration(-5)).toBe("0s");
});

test("formatCountdown clamps past deadlines to now", () => {
	expect(formatCountdown(40_000)).toBe("40s");
	expect(formatCountdown(70_000)).toBe("1m 10s");
	expect(formatCountdown(120_000)).toBe("2m");
	expect(formatCountdown(0)).toBe("now");
	expect(formatCountdown(-1_000)).toBe("now");
});

test("buildDetail maps a blocked work item to a decision view", () => {
	const view = buildDetail(
		projection({
			work: {
				pick: work("pick", {
					status: "blocked",
					blockedReason: "Which contract wins?",
					currentRunId: "run-1",
				}),
			},
			attempts: {
				"run-1": attempt("run-1", "pick", {
					lastEventAtMs: NOW - 60_000,
					tokens: { total: 118_000, cost: 0.42 },
				}),
			},
		}),
		workRef("pick"),
		NOW,
	);
	expect(view?.kind).toBe("decision");
	if (view?.kind === "decision") {
		expect(view.title).toBe("pick");
		expect(view.reason).toBe("Which contract wins?");
		expect(view.stage).toBe("blocked");
		expect(view.check).toBeUndefined();
		expect(view.metrics.tokens).toBe(118_000);
		expect(view.metrics.cost).toBe(0.42);
		expect(view.metrics.elapsed).toBe("1m");
		expect(view.decision.workKey).toBe("pick");
	}
});

test("buildDetail maps a running work item to an active view", () => {
	const view = buildDetail(
		projection({
			work: {
				busy: work("busy", { status: "running", currentRunId: "run-2" }),
			},
			attempts: {
				"run-2": attempt("run-2", "busy", {
					startedAtMs: NOW - 180_000,
					turnCount: 14,
					streaming: true,
					streams: { tool: "Reading dock", thinking: "hmm" },
					tokens: { input: 60_000, output: 32_000, cost: 0.31 },
				}),
			},
		}),
		workRef("busy"),
		NOW,
	);
	expect(view?.kind).toBe("active");
	if (view?.kind === "active") {
		expect(view.stage).toBe("working");
		expect(view.metrics.turn).toBe(14);
		expect(view.metrics.tokens).toBe(92_000);
		expect(view.metrics.cost).toBe(0.31);
		expect(view.metrics.elapsed).toBe("3m");
		expect(view.narrative).toEqual({ text: "hmm", llm: true });
	}
});

test("buildDetail active narrative prefers live prose and retains the last prose", () => {
	const withMessage = buildDetail(
		projection({
			work: {
				busy: work("busy", { status: "running", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "busy", {
					streams: {
						tool: "Reading files",
						thinking: "thinking",
						message: "**answer**",
					},
				}),
			},
		}),
		workRef("busy"),
		NOW,
	);
	const toolOnly = buildDetail(
		projection({
			work: {
				tooling: work("tooling", { status: "running", currentRunId: "run-2" }),
			},
			attempts: {
				"run-2": attempt("run-2", "tooling", {
					streams: { tool: "Running bun test" },
				}),
			},
		}),
		workRef("tooling"),
		NOW,
	);
	const retained = buildDetail(
		projection({
			work: {
				retained: work("retained", {
					status: "running",
					currentRunId: "run-3",
				}),
			},
			attempts: {
				"run-3": attempt("run-3", "retained", {
					streams: {},
					lastNarrative: { kind: "message", text: "previous answer" },
				}),
			},
		}),
		workRef("retained"),
		NOW,
	);

	expect(withMessage?.kind).toBe("active");
	if (withMessage?.kind === "active") {
		expect(withMessage.narrative).toEqual({ text: "**answer**", llm: true });
	}
	expect(retained?.kind).toBe("active");
	if (retained?.kind === "active") {
		expect(retained.narrative).toEqual({
			text: "previous answer",
			llm: true,
		});
	}
	expect(toolOnly?.kind).toBe("active");
	if (toolOnly?.kind === "active") {
		expect(toolOnly.narrative).toBeUndefined();
	}
});

test("buildDetail does not turn failed attempts into current work detail", () => {
	const view = buildDetail(
		projection({
			work: {
				broken: work("broken", { status: "pending" }),
			},
			completed: [
				{
					workKey: "broken",
					runId: "run-3",
					label: "broken",
					status: "failed",
					message: "boom",
					atMs: NOW - 120_000,
				},
			],
		}),
		workRef("broken"),
		NOW,
	);
	expect(view).toBeUndefined();
});

test("buildDetail resolves a settled ref, reading timeline via the runId", () => {
	const completed = {
		workKey: "done-1",
		runId: "run-9",
		label: "done-1",
		status: "succeeded",
		message: "shipped",
		atMs: NOW - 240_000,
		durationMs: 41_000,
	};
	const projectionValue = projection({
		completed: [completed],
		attempts: {
			"run-9": attempt("run-9", "done-1", {
				check: "passed",
				timeline: [{ atMs: 1, text: "edit drawer", kind: "edit" }],
				tokens: { total: 64_000, cost: 0.19 },
			}),
		},
	});
	const view = buildDetail(
		projectionValue,
		{ kind: "settled", key: settledKey(completed) },
		NOW,
	);
	expect(view?.kind).toBe("settled");
	if (view?.kind === "settled") {
		expect(view.message).toBe("shipped");
		expect(view.stage).toBe("run succeeded");
		expect(view.check).toBe("passed");
		expect(view.metrics.tokens).toBe(64_000);
		expect(view.metrics.cost).toBe(0.19);
		expect(view.metrics.elapsed).toBe("41s");
		expect(view.events).toHaveLength(1);
	}
});

test("buildDetail detects a failed settled item", () => {
	const completed = {
		workKey: "port-icon",
		runId: "run-x",
		label: "port-icon",
		status: "failed",
		message: "2 failed",
		atMs: NOW - 60_000,
	};
	const view = buildDetail(
		projection({ completed: [completed] }),
		{ kind: "settled", key: settledKey(completed) },
		NOW,
	);
	expect(view?.kind).toBe("failed");
});

test("buildDetail follows a work ref into completed when it settles out", () => {
	const view = buildDetail(
		projection({
			completed: [
				{
					workKey: "gone",
					runId: "r",
					label: "gone",
					status: "succeeded",
					message: "m",
					atMs: NOW - 1_000,
				},
			],
		}),
		workRef("gone"),
		NOW,
	);
	expect(view?.kind).toBe("settled");
	if (view?.kind === "settled") expect(view.title).toBe("gone");
});

test("buildDetail maps waiting work to held while queued remains closed", () => {
	expect(
		buildDetail(
			projection({ work: { q: work("q", { status: "pending" }) } }),
			workRef("q"),
			NOW,
		),
	).toBeUndefined();
	expect(
		buildDetail(
			projection({ work: { h: work("h", { status: "waiting" }) } }),
			workRef("h"),
			NOW,
		)?.kind,
	).toBe("held");
	expect(buildDetail(projection({}), workRef("nope"), NOW)).toBeUndefined();
	expect(
		buildDetail(projection({}), { kind: "settled", key: "x" }, NOW),
	).toBeUndefined();
});

test("buildDetail resolves a source ref with requirements and diagnostics", () => {
	const view = buildDetail(
		projection({
			sources: {
				"extension:jira": source({
					sourceId: "extension:jira",
					label: "Wix Jira",
					readiness: "action-required",
					diagnostics: ["last probe failed"],
					requirements: [
						{
							id: "mcp",
							label: "Wix MCP",
							status: "action-required",
							message: "Connect Wix MCP",
							actions: [{ id: "connect", label: "Connect" }],
						},
					],
				}),
			},
		}),
		{ kind: "source", sourceId: "extension:jira" },
		NOW,
	);
	expect(view?.kind).toBe("source");
	if (view?.kind === "source") {
		expect(view.sourceId).toBe("extension:jira");
		expect(view.title).toBe("Wix Jira");
		expect(view.status).toBe("action-required");
		expect(view.requirements).toHaveLength(1);
		expect(view.requirements[0]?.actions[0]?.label).toBe("Connect");
		expect(view.diagnostics).toEqual(["last probe failed"]);
	}
});

test("buildDetail carries the in-flight action's requirementId", () => {
	const view = buildDetail(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					readiness: "action-required",
					requirements: [
						{ id: "mcp", label: "MCP", status: "action-required" },
					],
					action: {
						actionRunId: "run-1",
						requirementId: "mcp",
						actionId: "connect",
						status: "running",
						progress: "Waiting…",
					},
				}),
			},
		}),
		{ kind: "source", sourceId: "w" },
		NOW,
	);
	expect(view?.kind).toBe("source");
	if (view?.kind === "source") {
		expect(view.action).toEqual({
			actionRunId: "run-1",
			requirementId: "mcp",
			status: "running",
			progress: "Waiting…",
		});
	}
});

test("buildDetail returns undefined when the source id is gone", () => {
	expect(
		buildDetail(projection({}), { kind: "source", sourceId: "gone" }, NOW),
	).toBeUndefined();
});

test("buildDetail keeps a ready source resolvable so the drawer survives", () => {
	const view = buildDetail(
		projection({
			sources: {
				w: source({
					sourceId: "w",
					readiness: "ready",
					requirements: [{ id: "mcp", label: "MCP", status: "ready" }],
				}),
			},
		}),
		{ kind: "source", sourceId: "w" },
		NOW,
	);
	expect(view?.kind).toBe("source");
	if (view?.kind === "source")
		expect(view.requirements.every((r) => r.status === "ready")).toBe(true);
});

test("refEquals compares source refs by sourceId", () => {
	expect(
		refEquals(
			{ kind: "source", sourceId: "a" },
			{ kind: "source", sourceId: "a" },
		),
	).toBe(true);
	expect(
		refEquals(
			{ kind: "source", sourceId: "a" },
			{ kind: "source", sourceId: "b" },
		),
	).toBe(false);
	expect(
		refEquals(
			{ kind: "source", sourceId: "a" },
			{ kind: "work", workKey: "a" },
		),
	).toBe(false);
});

test("openableRefs lists source refs first, in river order", () => {
	const p = projection({
		sources: { w: source({ sourceId: "w", readiness: "action-required" }) },
		work: { pick: work("pick", { status: "blocked", blockedReason: "b" }) },
	});
	expect(
		openableRefs({
			attention: buildAttention(p),
			motion: buildMotion(p),
			settled: buildSettled(p),
		}),
	).toEqual([
		{ kind: "source", sourceId: "w" },
		{ kind: "work", workKey: "pick" },
	]);
});

const walkerProjection = (): SerializedDashboardProjection =>
	projection({
		work: {
			dec: work("dec", {
				status: "blocked",
				blockedReason: "b",
				currentRunId: "rd",
			}),
			act: work("act", { status: "running", currentRunId: "ra" }),
			heldAction: work("heldAction", {
				status: "waiting",
				operatorActions: [{ id: "review-now", label: "Review now" }],
			}),
			q: work("q", { status: "pending" }),
		},
		attempts: {
			rd: attempt("rd", "dec", { lastEventAtMs: 100 }),
			ra: attempt("ra", "act", { startedAtMs: 50 }),
		},
		completed: [
			{
				workKey: "s",
				runId: "rs",
				label: "s",
				status: "succeeded",
				message: "m",
				atMs: 1,
			},
		],
		diagnostics: ["noise"],
	});

const walkerRefs = (): readonly DetailRef[] => {
	const p = walkerProjection();
	return openableRefs({
		attention: buildAttention(p),
		motion: buildMotion(p),
		settled: buildSettled(p),
	});
};

test("openableRefs lists attention, then active/actionable-held motion, then settled", () => {
	expect(walkerRefs()).toEqual([
		{ kind: "work", workKey: "dec" },
		{ kind: "work", workKey: "act" },
		{ kind: "work", workKey: "heldAction" },
		{ kind: "settled", key: "s:rs:1" },
	]);
});

test("stepRef walks and clamps at both ends without wrapping", () => {
	const refs = walkerRefs();
	expect(stepRef(refs, undefined, 1)).toEqual(refs[0]);
	expect(stepRef(refs, refs[0], 1)).toEqual(refs[1]);
	expect(stepRef(refs, refs[2], -1)).toEqual(refs[1]);
	expect(stepRef(refs, refs[3], 1)).toEqual(refs[3]);
	expect(stepRef(refs, refs[0], -1)).toEqual(refs[0]);
	expect(stepRef([], undefined, 1)).toBeUndefined();
});

test("formatTokens is coarse across boundaries", () => {
	expect(formatTokens(640)).toBe("640");
	expect(formatTokens(999)).toBe("999");
	expect(formatTokens(1_000)).toBe("1k");
	expect(formatTokens(118_000)).toBe("118k");
	expect(formatTokens(1_200_000)).toBe("1.2m");
	expect(formatTokens(2_000_000)).toBe("2m");
});

test("capTimeline keeps the newest 30 entries", () => {
	const rows: TimelineEntry[] = Array.from({ length: 35 }, (_, i) => ({
		kind: "edit",
		text: `e${i}`,
		atMs: i,
	}));
	const capped = capTimeline(rows);
	expect(capped).toHaveLength(30);
	expect(capped[0]?.text).toBe("e5");
	expect(capped[29]?.text).toBe("e34");
	expect(capTimeline(rows.slice(0, 10))).toHaveLength(10);
});

test("parseTranscript keeps well-formed entries and skips junk", () => {
	expect(
		parseTranscript({
			entries: [
				{
					at: "2026",
					role: "assistant",
					kind: "thinking",
					text: "hmm",
					name: "tool",
				},
			],
		}),
	).toEqual({
		entries: [
			{
				at: "2026",
				role: "assistant",
				kind: "thinking",
				text: "hmm",
				name: "tool",
			},
		],
		notRecorded: false,
	});

	const junk = parseTranscript({
		entries: [
			null,
			5,
			{ role: "nope", kind: "text", text: "x" },
			{ role: "user", kind: "weird", text: "y" },
			{ role: "user", kind: "text" },
			{ role: "tool", kind: "tool-result", text: "ok" },
		],
	});
	expect(junk.notRecorded).toBe(false);
	expect(junk.entries).toHaveLength(1);
	expect(junk.entries[0]?.text).toBe("ok");

	expect(parseTranscript("not an object")).toEqual({
		entries: [],
		notRecorded: false,
	});
});

test("fetchAttemptTranscript flags a 404 as not-recorded and parses a 200", async () => {
	const original = globalThis.fetch;
	try {
		globalThis.fetch = (async () =>
			new Response("no transcript recorded", {
				status: 404,
			})) as unknown as typeof fetch;
		expect(await fetchAttemptTranscript("run", "attempt")).toEqual({
			entries: [],
			notRecorded: true,
		});

		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					entries: [{ role: "tool", kind: "tool-result", text: "ok" }],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			)) as unknown as typeof fetch;
		const ok = await fetchAttemptTranscript("run", "attempt");
		expect(ok.notRecorded).toBe(false);
		expect(ok.entries).toHaveLength(1);
	} finally {
		globalThis.fetch = original;
	}
});
