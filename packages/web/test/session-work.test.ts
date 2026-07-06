import { expect, test } from "bun:test";
import type {
	SerializedDashboardProjection,
	TimelineEntry,
} from "@plot/projection";
import { fetchAttemptTranscript, parseTranscript } from "../src/data/api.js";
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
	factsLine,
	formatTokens,
	openableRefs,
	settledKey,
	stepRef,
	type DetailRef,
} from "../src/components/session-work/detail-view-model.js";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../src/lib/relative-time.js";

const NOW = 1_000_000;
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
	work: {},
	attempts: {},
	completed: [],
	diagnostics: [],
	scheduledWakes: [],
	activity: [],
	debugEvents: [],
	...overrides,
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

test("buildAttention makes a decision from operatorActions without blocked", () => {
	const attention = buildAttention(
		projection({
			work: {
				review: work("review", {
					status: "waiting",
					operatorActions: [{ id: "merge", label: "Merge" }],
				}),
			},
		}),
	);
	expect(attention).toHaveLength(1);
	const item = attention[0];
	expect(item?.kind).toBe("decision");
	if (item?.kind === "decision") {
		expect(item.actions.map((action) => action.id)).toEqual(["merge"]);
	}
});

test("buildAttention turns failed work into a failure with the attempt line", () => {
	const attention = buildAttention(
		projection({
			work: {
				broken: work("broken", { status: "failed", currentRunId: "run-1" }),
			},
			attempts: {
				"run-1": attempt("run-1", "broken", {
					lastDisplay: "bun test: 2 failed",
					lastEventAtMs: 500,
				}),
			},
		}),
	);
	expect(attention).toEqual([
		{
			kind: "failure",
			key: "broken",
			title: "broken",
			sinceMs: 500,
			line: "bun test: 2 failed",
		},
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

test("buildAttention orders decisions and failures oldest-first, unknown last", () => {
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
					status: "failed",
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

test("buildMotion puts running work before waiting, startedAtMs ascending", () => {
	const motion = buildMotion(
		projection({
			work: {
				second: work("second", { status: "running", currentRunId: "run-2" }),
				queuedItem: work("a-queued", { status: "waiting" }),
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

	const rb = attempt("rb", "b", {});
	delete (rb as { activity?: string }).activity;
	const subtitle = buildMotion(
		projection({
			work: {
				b: work("b", {
					status: "running",
					currentRunId: "rb",
					subtitle: "queued behind CI",
				}),
			},
			attempts: { rb },
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
					status: "done",
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
		status: i === 1 ? "failed" : i === 2 ? "error" : "done",
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
				two: work("two", { status: "failed" }),
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
		expect(view.wordLine).toBe("blocked · 1m");
		expect(view.factsLine).toBe("118k tokens · $0.42");
		expect(view.decision.workKey).toBe("pick");
	}
});

test("buildDetail maps a running work item to an active view with streams", () => {
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
		expect(view.wordLine).toBe("running · 3m · turn 14");
		expect(view.tool).toBe("Reading dock");
		expect(view.thinking).toBe("hmm");
		expect(view.streaming).toBe(true);
		expect(view.factsLine).toBe("92k tokens · $0.31");
	}
});

test("buildDetail detects a failed active work item", () => {
	const view = buildDetail(
		projection({
			work: {
				broken: work("broken", { status: "failed", currentRunId: "run-3" }),
			},
			attempts: {
				"run-3": attempt("run-3", "broken", {
					lastDisplay: "boom",
					lastEventAtMs: NOW - 120_000,
					startedAtMs: NOW - 300_000,
				}),
			},
		}),
		workRef("broken"),
		NOW,
	);
	expect(view?.kind).toBe("failed");
	if (view?.kind === "failed") {
		expect(view.message).toBe("boom");
		expect(view.wordLine).toBe("failed · 2m ago · took 3m");
	}
});

test("buildDetail resolves a settled ref, reading timeline via the runId", () => {
	const completed = {
		workKey: "done-1",
		runId: "run-9",
		label: "done-1",
		status: "done",
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
		expect(view.wordLine).toBe("done · 4m ago · took 41s");
		expect(view.factsLine).toBe("64k tokens · $0.19 · checks passed");
		expect(view.timeline).toHaveLength(1);
	}
});

test("buildDetail detects a failed settled item", () => {
	const completed = {
		workKey: "port-icon",
		runId: "run-x",
		label: "port-icon",
		status: "error",
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
					status: "done",
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

test("buildDetail returns undefined for queued, diagnostic, and missing refs", () => {
	expect(
		buildDetail(
			projection({ work: { q: work("q", { status: "waiting" }) } }),
			workRef("q"),
			NOW,
		),
	).toBeUndefined();
	expect(buildDetail(projection({}), workRef("nope"), NOW)).toBeUndefined();
	expect(
		buildDetail(projection({}), { kind: "settled", key: "x" }, NOW),
	).toBeUndefined();
});

const walkerProjection = (): SerializedDashboardProjection =>
	projection({
		work: {
			dec: work("dec", {
				status: "blocked",
				blockedReason: "b",
				currentRunId: "rd",
			}),
			fail: work("fail", { status: "failed", currentRunId: "rf" }),
			act: work("act", { status: "running", currentRunId: "ra" }),
			q: work("q", { status: "waiting" }),
		},
		attempts: {
			rd: attempt("rd", "dec", { lastEventAtMs: 100 }),
			rf: attempt("rf", "fail", { lastEventAtMs: 200 }),
			ra: attempt("ra", "act", { startedAtMs: 50 }),
		},
		completed: [
			{
				workKey: "s",
				runId: "rs",
				label: "s",
				status: "done",
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

test("openableRefs lists attention, then motion, then settled; skips queued and diagnostics", () => {
	expect(walkerRefs()).toEqual([
		{ kind: "work", workKey: "dec" },
		{ kind: "work", workKey: "fail" },
		{ kind: "work", workKey: "act" },
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

test("factsLine omits missing tokens, cost, and non-terminal checks", () => {
	expect(factsLine({})).toBeUndefined();
	expect(factsLine({ tokens: 118_000 })).toBe("118k tokens");
	expect(factsLine({ cost: 0.42 })).toBe("$0.42");
	expect(factsLine({ check: "failed" })).toBe("checks failed");
	expect(factsLine({ check: "not-run" })).toBeUndefined();
	expect(factsLine({ tokens: 118_000, check: "running" })).toBe("118k tokens");
	expect(factsLine({ tokens: 118_000, cost: 0.42, check: "passed" })).toBe(
		"118k tokens · $0.42 · checks passed",
	);
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
