import type { SessionState } from "@plot/session-manager/session";
import type { SessionHeaderContextValue } from "./session-header/context.js";
import type { SessionWorkContextValue } from "./session-work/context.js";
import type { WorkDetailContextValue } from "./session-work/detail-context.js";
import type { DetailView } from "./session-work/detail-view-model.js";

export const STORY_NOW = 1_720_000_000_000;

const noop = (): void => undefined;

export const storySessionHeader = (
	status: SessionState,
	title = "pr-review",
): SessionHeaderContextValue => ({
	state: {
		place: "epic",
		title,
		status,
		startedAtMs: status === "starting" ? undefined : STORY_NOW - 12 * 60_000,
		lastEventAtMs: STORY_NOW - 3_000,
		nowMs: STORY_NOW,
		throughputGraph: "▇█▆█▇█▆▇",
		throughputRate: 42,
		stderrTail:
			status === "error" ? "Error: ECONNREFUSED 127.0.0.1:4317" : undefined,
		usage: { tokens: 48_300, cost: 0.42 },
		config: {
			model: "claude-opus-4-8",
			provider: "anthropic",
			workflow: title,
			workflowPath: `examples/${title}/WORKFLOW.md`,
			cwd: "/Users/igors/workspace/dev/personal/epic",
			skills: ["verify", "code-review", "deep-research"],
			tickIntervalMs: 30_000,
			maxConcurrentRuns: 8,
			maxRunDurationMs: 3_600_000,
		},
	},
	actions: { stop: noop, stopping: false },
});

export const storySessionWork: SessionWorkContextValue = {
	state: {
		nowMs: STORY_NOW,
		attention: [
			{
				kind: "source",
				key: "source:jira",
				sourceId: "extension:jira",
				title: "Wix Jira",
				status: "action-required",
				message: "Connect Wix MCP to discover Jira issues.",
			},
			{
				kind: "decision",
				key: "decision:deploy",
				workKey: "deploy",
				sourceId: "github",
				title: "Approve deploy to staging?",
				sinceMs: STORY_NOW - 120_000,
				reason: "Verification passed on all three checks.",
				actions: [
					{
						id: "approve",
						label: "Approve",
						tone: "primary",
						requiresComment: false,
					},
				],
			},
			{
				kind: "failure",
				key: "failure:verify",
				title: "verify step failed",
				sinceMs: STORY_NOW - 60_000,
				line: "AssertionError: expected 200, received 500",
			},
		],
		motion: [
			{
				kind: "active",
				key: "host-refactor",
				title: "Refactor the host message pump",
				sinceMs: STORY_NOW - 24_000,
				line: { text: "editing packages/session/src/host.ts", llm: false },
				streaming: true,
				verifying: false,
			},
			{
				kind: "queued",
				key: "retry-integration",
				title: "Re-run the flaky integration test",
				sub: "held until the worktree settles",
				wakeDueAtMs: STORY_NOW + 4 * 60_000,
			},
			{
				kind: "held",
				key: "held:migration",
				workKey: "migration",
				sourceId: "jira",
				title: "Migrate the token store",
				reason: "Waiting for the schema owner",
				actions: [],
			},
		],
		settled: [
			{
				key: "settled:commit",
				label: "committed",
				message: "refine host message pump · c634736",
				failed: false,
				atMs: STORY_NOW - 8 * 60_000,
				durationMs: 64_000,
			},
			{
				key: "settled:test",
				label: "test passed",
				message: "84 tests across packages/web",
				failed: false,
				atMs: STORY_NOW - 20 * 60_000,
				durationMs: 42_000,
			},
		],
		denseDecisions: false,
		loaded: true,
	},
	actions: {
		act: noop,
		actOnSource: noop,
		cancelSourceAction: noop,
		acting: false,
	},
};

const decision: DetailView = {
	kind: "decision",
	ref: { kind: "work", workKey: "deploy" },
	title: "Approve deploy to staging?",
	subtitle: "vercel/next.js #402",
	labels: ["deploy", "p1"],
	url: "https://github.com/vercel/next.js/pull/402",
	stage: "blocked",
	check: "passed",
	metrics: { turn: 5, tokens: 48_300, cost: 0.42, elapsed: "2m" },
	events: [
		{ kind: "read", text: "PR #402 description", atMs: STORY_NOW - 200_000 },
		{ kind: "read", text: "the diff — 12 files", atMs: STORY_NOW - 180_000 },
		{ kind: "test", text: "lint · type · unit", atMs: STORY_NOW - 120_000 },
		{ kind: "test", text: "all checks passed", atMs: STORY_NOW - 110_000 },
		{ kind: "wait", text: "awaiting operator", atMs: STORY_NOW - 100_000 },
	],
	reason:
		"Verification passed on lint, type-check, and the full unit suite. The build is reproducible and the change is waiting for one operator decision.",
	decision: {
		sourceId: "github",
		workKey: "deploy",
		actions: [
			{
				id: "approve",
				label: "Approve",
				tone: "primary",
				requiresComment: false,
			},
			{
				id: "reject",
				label: "Reject",
				tone: "danger",
				requiresComment: false,
				confirmTitle: "Confirm reject",
			},
		],
	},
};

const active: DetailView = {
	kind: "active",
	ref: { kind: "work", workKey: "host-refactor" },
	title: "Refactor the host message pump",
	subtitle: "packages/session",
	labels: ["refactor"],
	url: undefined,
	stage: "working",
	check: "running",
	metrics: { turn: 3, tokens: 12_000, cost: 0.08, elapsed: "24s" },
	narrative: {
		text: "I'm tracing the message pump and extracting the dispatch seam before touching protocol ownership.",
		llm: true,
	},
	events: [
		{ kind: "read", text: "host.ts · protocol.ts", atMs: STORY_NOW - 60_000 },
		{ kind: "search", text: "dispatch call sites", atMs: STORY_NOW - 50_000 },
		{ kind: "edit", text: "extract dispatch()", atMs: STORY_NOW - 40_000 },
		{ kind: "edit", text: "wire reducer into pump", atMs: STORY_NOW - 25_000 },
	],
};

const source: DetailView = {
	kind: "source",
	ref: { kind: "source", sourceId: "extension:jira" },
	sourceId: "extension:jira",
	title: "Wix Jira",
	status: "action-required",
	requirements: [
		{
			id: "wix-mcp",
			label: "Wix MCP",
			status: "action-required",
			message: "Connect Wix MCP to discover Jira issues.",
			actions: [
				{
					id: "connect",
					label: "Connect Wix MCP",
					tone: "primary",
					requiresComment: false,
				},
			],
		},
	],
	diagnostics: ["Last probe: 401 from mcp.wix.com"],
};

const settled: DetailView = {
	kind: "settled",
	ref: { kind: "settled", key: "settled:commit" },
	title: "committed refine host message pump",
	subtitle: undefined,
	labels: ["merged"],
	url: "https://github.com/plot/plot/commit/c634736",
	stage: "run succeeded",
	check: "passed",
	metrics: { turn: 8, tokens: 86_000, cost: 0.61, elapsed: "1m 04s" },
	events: [
		{ kind: "read", text: "host.ts", atMs: STORY_NOW - 480_000 },
		{ kind: "edit", text: "6 files", atMs: STORY_NOW - 300_000 },
		{ kind: "test", text: "42 passing", atMs: STORY_NOW - 60_000 },
		{ kind: "finish", text: "committed c634736", atMs: STORY_NOW - 4_000 },
	],
	message: "Committed the message-pump refactor. 6 files changed, tests green.",
};

const failed: DetailView = {
	kind: "failed",
	ref: { kind: "work", workKey: "verify" },
	title: "verify step failed",
	subtitle: "host.test.ts:42",
	labels: ["ci"],
	url: undefined,
	stage: "failed",
	check: "failed",
	metrics: { turn: 2, tokens: 9_000, cost: undefined, elapsed: "1m" },
	events: [
		{ kind: "read", text: "host.ts", atMs: STORY_NOW - 120_000 },
		{
			kind: "run",
			text: "bun test test/host.test.ts",
			atMs: STORY_NOW - 90_000,
		},
		{ kind: "test", text: "1 assertion failed", atMs: STORY_NOW - 60_000 },
	],
	message:
		"AssertionError: expected 200, received 500 — host.test.ts:42. The gateway returned an error before the Session was ready.",
};

export const storyDetailViews = {
	decision,
	active,
	source,
	settled,
	failed,
} as const;

export const storyWorkDetail = (
	view: DetailView | undefined,
): WorkDetailContextValue => ({
	state: { open: view !== undefined, view, nowMs: STORY_NOW },
	actions: {
		open: noop,
		back: noop,
		close: noop,
		step: noop,
		act: noop,
		acting: false,
	},
});
