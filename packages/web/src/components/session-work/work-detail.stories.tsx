import type { Meta, StoryObj } from "@storybook/react-vite";
import {
	SessionWorkProvider,
	type SessionWorkContextValue,
} from "./context.js";
import {
	WorkDetailProvider,
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
	subtitle: "vercel/next.js #402",
	labels: ["deploy", "p1"],
	url: "https://github.com/vercel/next.js/pull/402",
	stage: "blocked",
	check: "passed",
	metrics: { turn: 5, tokens: 48_300, cost: 0.42, elapsed: "2m" },
	events: [
		{ kind: "read", text: "PR #402 description", atMs: NOW - 200_000 },
		{ kind: "read", text: "the diff — 12 files", atMs: NOW - 180_000 },
		{ kind: "test", text: "lint · type · unit", atMs: NOW - 120_000 },
		{ kind: "test", text: "all checks passed", atMs: NOW - 110_000 },
		{ kind: "wait", text: "awaiting operator", atMs: NOW - 100_000 },
	],
	reason:
		"Verification passed on all three checks — lint, type-check, and the full unit suite (42 tests). The build is reproducible and the diff touches only the message-pump module, so the blast radius is small. Approve to promote the build to staging, or reject to hold it here and let the workflow retry from a fresh attempt.",
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
	subtitle: "packages/session",
	labels: ["refactor"],
	url: undefined,
	stage: "working",
	check: "running",
	metrics: { turn: 3, tokens: 12_000, cost: 0.08, elapsed: "24s" },
	events: [
		{ kind: "read", text: "host.ts · protocol.ts", atMs: NOW - 60_000 },
		{ kind: "search", text: "dispatch call sites", atMs: NOW - 50_000 },
		{ kind: "edit", text: "extract dispatch()", atMs: NOW - 40_000 },
		{ kind: "edit", text: "wire reducer into pump", atMs: NOW - 25_000 },
		{ kind: "edit", text: "host.ts message pump", atMs: NOW - 2_000 },
	],
};

const SETTLED: DetailView = {
	kind: "settled",
	ref: { kind: "settled", key: "c" },
	title: "committed refine host message pump",
	subtitle: undefined,
	labels: ["merged"],
	url: "https://github.com/plot/plot/commit/c634736",
	stage: "done",
	check: "passed",
	metrics: { turn: 8, tokens: 86_000, cost: 0.61, elapsed: "1m 04s" },
	events: [
		{ kind: "read", text: "host.ts", atMs: NOW - 480_000 },
		{ kind: "edit", text: "6 files", atMs: NOW - 300_000 },
		{ kind: "test", text: "host.test.ts", atMs: NOW - 120_000 },
		{ kind: "test", text: "42 passing", atMs: NOW - 60_000 },
		{ kind: "finish", text: "committed c634736", atMs: NOW - 4_000 },
	],
	message: "Committed the message-pump refactor. 6 files changed, tests green.",
};

const FAILED: DetailView = {
	kind: "failed",
	ref: { kind: "work", workKey: "d" },
	title: "verify step failed",
	subtitle: "host.test.ts:42",
	labels: ["ci"],
	url: undefined,
	stage: "failed",
	check: "failed",
	metrics: { turn: 2, tokens: 9_000, cost: undefined, elapsed: "1m" },
	events: [
		{ kind: "read", text: "host.ts", atMs: NOW - 120_000 },
		{ kind: "run", text: "bun test test/host.test.ts", atMs: NOW - 90_000 },
		{ kind: "test", text: "1 assertion failed", atMs: NOW - 60_000 },
	],
	message:
		"AssertionError: expected 200, received 500 — host.test.ts:42. The gateway returned an error before the session was ready.",
};

const detailValue = (view: DetailView): WorkDetailContextValue => ({
	state: { view, nowMs: NOW },
	actions: {
		open: () => {},
		close: () => {},
		step: () => {},
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
