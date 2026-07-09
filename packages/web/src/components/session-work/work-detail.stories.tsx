import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	SessionWorkProvider,
	type SessionWorkContextValue,
} from "./context.js";
import {
	WorkDetailProvider,
	type TranscriptPanel,
	type WorkDetailContextValue,
} from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";
import { WorkDetail } from "./work-detail.js";

/**
 * The work detail body across its four kinds. Iterated here in isolation via a
 * mocked context, then wired into the split layout in production.
 */
const meta = {
	title: "Work/Work Detail",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

const NOW = 1_720_000_000_000;

const DECISION: DetailView = {
	kind: "decision",
	ref: { kind: "work", workKey: "a" },
	title: "Approve deploy to staging?",
	wordLine: "blocked · 2m",
	factsLine: "48k tokens · $0.42",
	attemptRunId: "run-1",
	timeline: [
		{ kind: "run", text: "compiled 42 modules", atMs: NOW - 180_000 },
		{ kind: "test", text: "all checks passed", atMs: NOW - 120_000 },
		{ kind: "wait", text: "awaiting operator decision", atMs: NOW - 120_000 },
	],
	reason:
		"Verification passed on all three checks. Approve to promote the build to staging, or reject to hold and let the workflow retry.",
	decision: {
		sourceId: "s1",
		workKey: "a",
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

const ACTIVE: DetailView = {
	kind: "active",
	ref: { kind: "work", workKey: "b" },
	title: "Refactor the host message pump",
	wordLine: "running · 20s · turn 3",
	factsLine: "12k tokens · $0.08",
	attemptRunId: "run-2",
	timeline: [
		{ kind: "read", text: "host.ts, protocol.ts", atMs: NOW - 60_000 },
		{ kind: "edit", text: "extract dispatch()", atMs: NOW - 40_000 },
		{ kind: "edit", text: "wire reducer into pump", atMs: NOW - 20_000 },
	],
	tool: "edit packages/session/src/host.ts",
	thinking:
		"Extracting the dispatch loop into a standalone reducer so the transport can be swapped without touching the state machine.",
	streaming: true,
};

const SETTLED: DetailView = {
	kind: "settled",
	ref: { kind: "settled", key: "c" },
	title: "committed refine host message pump",
	wordLine: "done · 8m ago · took 1m 04s",
	factsLine: "86k tokens · $0.61 · checks passed",
	attemptRunId: "run-3",
	timeline: [{ kind: "finish", text: "c634736", atMs: NOW - 480_000 }],
	message: "Committed the message-pump refactor. 6 files changed, tests green.",
};

const FAILED: DetailView = {
	kind: "failed",
	ref: { kind: "work", workKey: "d" },
	title: "verify step failed",
	wordLine: "failed · 1m ago",
	factsLine: "9k tokens · checks failed",
	attemptRunId: "run-4",
	timeline: [
		{ kind: "run", text: "bun test test/host.test.ts", atMs: NOW - 90_000 },
		{ kind: "test", text: "1 assertion failed", atMs: NOW - 60_000 },
	],
	message:
		"AssertionError: expected 200, received 500 — host.test.ts:42. The gateway returned an error before the session was ready.",
};

const transcript: TranscriptPanel = {
	expanded: false,
	loading: false,
	entries: [],
	notRecorded: true,
	error: undefined,
};

const detailValue = (view: DetailView): WorkDetailContextValue => ({
	state: { view, nowMs: NOW, transcript },
	actions: {
		open: () => {},
		close: () => {},
		step: () => {},
		toggleTranscript: () => {},
		act: () => {},
		acting: false,
	},
});

const workValue: SessionWorkContextValue = {
	state: {
		nowMs: NOW,
		attention: [],
		motion: [],
		settled: [],
		denseDecisions: false,
		loaded: true,
	},
	actions: { act: () => {}, acting: false },
};

function panel(view: DetailView): StoryObj {
	return {
		render: () => (
			<SessionWorkProvider value={workValue}>
				<WorkDetailProvider value={detailValue(view)}>
					<div
						style={{
							width: 460,
							height: 640,
							overflow: "hidden",
							border: "1px solid var(--border)",
							borderRadius: 14,
							background: "var(--background)",
						}}
					>
						<WorkDetail />
					</div>
				</WorkDetailProvider>
			</SessionWorkProvider>
		),
	};
}

export const Decision = panel(DECISION);
export const Active = panel(ACTIVE);
export const Settled = panel(SETTLED);
export const Failed = panel(FAILED);
