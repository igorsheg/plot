/**
 * Dev-only storybook substitute. Renders the session header in every fixture
 * state through the plain-value provider, plus one fully-axed live chart to
 * exercise the chart module's whole API. Reached at /lab in dev (see main.tsx).
 *
 * Fixture series are deterministic functions of index — no module-top randomness.
 */

import type { TranscriptEntry } from "@plot/session/transcript";
import { type CSSProperties, useEffect, useState } from "react";
import {
	SessionDockProvider,
	type SessionDockContextValue,
} from "../components/session-dock/context.js";
import { SessionDock } from "../components/session-dock/session-dock.js";
import type { DockTile } from "../components/session-dock/view-model.js";
import {
	SessionHeaderProvider,
	type SessionHeaderContextValue,
	type SessionHeaderState,
} from "../components/session-header/context.js";
import { SessionHeader } from "../components/session-header/session-header.js";
import {
	SessionWorkProvider,
	type SessionWorkContextValue,
	type SessionWorkState,
} from "../components/session-work/context.js";
import {
	WorkDetailProvider,
	type TranscriptPanel,
	type WorkDetailContextValue,
} from "../components/session-work/detail-context.js";
import type { DetailView } from "../components/session-work/detail-view-model.js";
import { WorkDrawer } from "../components/session-work/drawer.js";
import { SessionWork } from "../components/session-work/session-work.js";
import { LiveXAxis, LiveYAxis } from "../components/ui/live-line/live-axes.js";
import { LiveLineChart } from "../components/ui/live-line/live-line-chart.js";
import { LiveLine } from "../components/ui/live-line/live-line.js";
import type { LiveLinePoint } from "../components/ui/live-line/scale.js";
import { VStack } from "../components/ui/stack.js";
import { Text } from "../components/ui/text.js";

const noop = (): void => undefined;

const nowMs = Date.now();
const nowSec = Math.floor(nowMs / 1000);

const waveSeries = (amp: number, base: number): LiveLinePoint[] =>
	Array.from({ length: 28 }, (_, i) => ({
		time: nowSec - (27 - i) * 10,
		value: Math.max(0, base + amp * Math.sin(i * 0.7) + (i % 4)),
	}));

const flatSeries = (value: number): LiveLinePoint[] =>
	Array.from({ length: 28 }, (_, i) => ({
		time: nowSec - (27 - i) * 10,
		value,
	}));

const fixture = (
	overrides: Partial<SessionHeaderState> & Pick<SessionHeaderState, "status">,
): SessionHeaderContextValue => ({
	state: {
		place: "epic",
		title: "Port kumo primitives",
		startedAtMs: nowMs - 25 * 60_000,
		lastEventAtMs: nowMs - 4_000,
		nowMs,
		series: [],
		rate: 0,
		stderrTail: undefined,
		...overrides,
	},
	actions: { stop: noop, stopping: false },
});

const workingSeries = waveSeries(12, 18);
const workingRate = workingSeries.at(-1)?.value ?? 0;

const specimens: readonly {
	label: string;
	value: SessionHeaderContextValue;
}[] = [
	{
		label: "working (dense series, recent last event)",
		value: fixture({
			status: "online",
			series: workingSeries,
			rate: workingRate,
			lastEventAtMs: nowMs - 4_000,
		}),
	},
	{
		label: "idle (flat series, last event 6m ago)",
		value: fixture({
			status: "online",
			series: flatSeries(1),
			rate: 1,
			lastEventAtMs: nowMs - 6 * 60_000,
		}),
	},
	{
		label: "starting",
		value: fixture({ status: "starting", lastEventAtMs: undefined }),
	},
	{
		label: "stopping",
		value: fixture({
			status: "stopping",
			series: workingSeries,
			rate: workingRate,
		}),
	},
	{
		label: "errored (EADDRINUSE stderr tail)",
		value: fixture({
			status: "error",
			stderrTail: "Error: listen EADDRINUSE: address already in use :::3000",
		}),
	},
	{
		label: "stopped (past session, read-only)",
		value: fixture({ status: "stopped", lastEventAtMs: undefined }),
	},
];

const closedTranscript: TranscriptPanel = {
	expanded: false,
	loading: false,
	entries: [],
	notRecorded: false,
	error: undefined,
};

const noopDetailActions: WorkDetailContextValue["actions"] = {
	open: noop,
	close: noop,
	step: noop,
	toggleTranscript: noop,
	act: noop,
	acting: false,
};

const detailValue = (
	view: DetailView | undefined,
	transcript: TranscriptPanel = closedTranscript,
): WorkDetailContextValue => ({
	state: { view, nowMs, transcript },
	actions: noopDetailActions,
});

/** Rows in the river specimens are non-interactive without a live projection. */
const closedDetail = detailValue(undefined);

const workFixture = (
	overrides: Partial<SessionWorkState>,
): SessionWorkContextValue => ({
	state: {
		nowMs,
		attention: [],
		motion: [],
		settled: [],
		denseDecisions: false,
		loaded: true,
		...overrides,
	},
	actions: { act: noop, acting: false },
});

const decisionFixture = (
	index: number,
	title: string,
	reason: string,
): SessionWorkState["attention"][number] => ({
	kind: "decision",
	key: `decision-${index}`,
	workKey: `decision-${index}`,
	sourceId: "lab",
	title,
	sinceMs: nowMs - (index + 12) * 60_000,
	reason,
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
			requiresComment: true,
			confirmTitle: "Really reject?",
		},
	],
});

const settledFixtures: SessionWorkState["settled"] = [
	{
		key: "port-stack",
		label: "port-stack",
		message: "Stack + VStack ported, 12 tests passing",
		failed: false,
		atMs: nowMs - 4 * 60_000,
		durationMs: 41_000,
	},
	{
		key: "port-icon",
		label: "port-icon",
		message: "bun test: 2 failed — glyph metrics drift",
		failed: true,
		atMs: nowMs - 12 * 60_000,
		durationMs: 3 * 60_000,
	},
	{
		key: "fix-tokens",
		label: "fix-tokens",
		message: "Replaced 9 raw oklch values",
		failed: false,
		atMs: nowMs - 26 * 60_000,
		durationMs: 58_000,
	},
];

const workSpecimens: readonly {
	label: string;
	value: SessionWorkContextValue;
}[] = [
	{
		label: "river-full (decision + active + queued + settled)",
		value: workFixture({
			attention: [
				decisionFixture(
					0,
					"api-contract",
					"Two Button APIs diverged — kumo's icon prop vs our slot. Which wins?",
				),
			],
			motion: [
				{
					kind: "active",
					key: "design-review",
					title: "design-review",
					sinceMs: nowMs - 3 * 60_000,
					// LLM-authored message stream: real markdown, flattened + truncated
					// to one line by StreamedLine.
					line: {
						text: "Clamping **rovingKey** to the live `order` before the next paint",
						llm: true,
					},
					streaming: true,
					verifying: false,
				},
				{
					kind: "active",
					key: "port-button",
					title: "port-button",
					sinceMs: nowMs - 8 * 60_000,
					// Tool command: NOT markdown — stays plain mono.
					line: { text: "bun test test/button.test.tsx", llm: false },
					streaming: false,
					verifying: true,
				},
				{
					kind: "queued",
					key: "port-text",
					title: "port-text",
					sub: "Waiting for CI on #164",
					wakeDueAtMs: nowMs + 40_000,
				},
			],
			settled: settledFixtures,
		}),
	},
	{ label: "fresh (all empty)", value: workFixture({}) },
	{
		label: "all-settled (no hairline)",
		value: workFixture({ settled: settledFixtures }),
	},
	{
		label: "decision-heavy (3 decisions, dense)",
		value: workFixture({
			attention: [
				decisionFixture(
					0,
					"api-contract",
					"Two Button APIs diverged — kumo's icon prop vs our slot. Which wins?",
				),
				decisionFixture(
					1,
					"icon-set",
					"Phosphor duotone or regular weight for the dock glyphs?",
				),
				decisionFixture(
					2,
					"palette",
					"Keep raw oklch ramps or collapse to semantic aliases only?",
				),
			],
			denseDecisions: true,
		}),
	},
	{
		label: "crashing (failure + diagnostics)",
		value: workFixture({
			attention: [
				{
					kind: "failure",
					key: "port-icon",
					title: "port-icon",
					sinceMs: nowMs - 2 * 60_000,
					line: "bun test: 2 failed — glyph metrics drift",
				},
				{
					kind: "diagnostic",
					key: "diagnostic:0",
					text: "daemon restarted after OOM",
				},
				{
					kind: "diagnostic",
					key: "diagnostic:1",
					text: "registry sequence reset detected",
				},
			],
		}),
	},
];

const detailTimeline: DetailView["timeline"] = [
	{ kind: "read", text: "Read session-dock.tsx", atMs: nowMs - 130_000 },
	{
		kind: "search",
		text: "Grep for roving-key handling",
		atMs: nowMs - 95_000,
	},
	{
		kind: "edit",
		text: "Edit drawer.tsx — compose base-ui parts",
		atMs: nowMs - 40_000,
	},
	{
		kind: "run",
		text: "bun test test/session-work.test.ts",
		atMs: nowMs - 6_000,
	},
];

const detailTranscript: readonly TranscriptEntry[] = [
	{
		role: "assistant",
		kind: "thinking",
		text: "Glyph metrics drift usually means the test env never loaded the variable font.",
	},
	{
		role: "assistant",
		kind: "tool-call",
		name: "bun",
		text: '{\n "args": ["test"]\n}',
	},
	{ role: "tool", kind: "tool-result", text: "2 failed, 10 passed" },
	{
		role: "assistant",
		kind: "text",
		text: "Both failures are 0.5px off — a fallback font is being measured, not Inter.",
	},
];

const expandedTranscript: TranscriptPanel = {
	expanded: true,
	loading: false,
	entries: detailTranscript,
	notRecorded: false,
	error: undefined,
};

const activeDetail: DetailView = {
	kind: "active",
	ref: { kind: "work", workKey: "design-review" },
	title: "design-review",
	wordLine: "running · 3m · turn 14",
	factsLine: "118k tokens · $0.42",
	attemptRunId: "run-active",
	timeline: detailTimeline,
	tool: "Reading session-dock.tsx\n  const activeKey =\n    rovingKey !== null && order.includes(rovingKey)\n      ? rovingKey\n      : order[0] ?? null;",
	thinking:
		"The roving key must survive a live reorder, so clamp it to the current order.",
	streaming: true,
};

const decisionDetail: DetailView = {
	kind: "decision",
	ref: { kind: "work", workKey: "api-contract" },
	title: "api-contract",
	wordLine: "blocked · 12m",
	factsLine: "92k tokens · $0.31",
	attemptRunId: "run-decision",
	timeline: detailTimeline,
	reason:
		"Two Button APIs diverged — kumo's icon prop vs our slot-based children. One has to win before the dock and drawer can share a close button. Which contract wins?",
	decision: {
		sourceId: "lab",
		workKey: "api-contract",
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
				requiresComment: true,
				confirmTitle: "Really reject?",
			},
		],
	},
};

const failedDetail: DetailView = {
	kind: "failed",
	ref: { kind: "settled", key: "port-icon:run-icon:0" },
	title: "port-icon",
	wordLine: "failed · 12m ago · took 3m",
	factsLine: "64k tokens · $0.19 · checks failed",
	attemptRunId: "run-icon",
	timeline: detailTimeline,
	message: "bun test: 2 failed — glyph metrics drift",
};

const drawerSpecimens: readonly {
	label: string;
	value: WorkDetailContextValue;
}[] = [
	{ label: "open-active (streaming caret)", value: detailValue(activeDetail) },
	{ label: "open-decision", value: detailValue(decisionDetail) },
	{
		label: "open-failed (transcript pre-expanded)",
		value: detailValue(failedDetail, expandedTranscript),
	},
];

const drawerStageStyle: CSSProperties = {
	background: "var(--color-kumo-canvas)",
	border: "1px solid var(--color-kumo-hairline)",
	borderRadius: 12,
	height: 560,
	overflow: "hidden",
	position: "relative",
	// A transform makes the drawer's `position: fixed` resolve to this stage, so
	// the three specimens don't fight over the viewport.
	transform: "translateZ(0)",
	width: "100%",
};

function DrawerSpecimen({ value }: { readonly value: WorkDetailContextValue }) {
	const [stage, setStage] = useState<HTMLDivElement | null>(null);
	return (
		<div ref={setStage} style={drawerStageStyle}>
			{stage !== null && (
				<SessionWorkProvider value={workFixture({})}>
					<WorkDetailProvider value={value}>
						<WorkDrawer container={stage} />
					</WorkDetailProvider>
				</SessionWorkProvider>
			)}
		</div>
	);
}

const liveTile = (
	id: string,
	name: string,
	extra: Partial<DockTile> = {},
): DockTile => ({
	id,
	name,
	place: "epic",
	selected: false,
	errored: false,
	...extra,
});

const pastTile = (id: string, name: string, agoMs: number): DockTile => ({
	id,
	name,
	place: "epic",
	selected: false,
	errored: false,
	stoppedAtMs: nowMs - agoMs,
});

const dockSpecimens: readonly {
	label: string;
	live: readonly DockTile[];
	past: readonly DockTile[];
}[] = [
	{
		label: "interactive-full (3 live, one errored, selected first, 3 past)",
		live: [
			liveTile("web", "epic-web", { selected: true }),
			liveTile("api", "gateway-api"),
			liveTile("boom", "flaky-runner", { errored: true }),
		],
		past: [
			pastTile("p1", "port-stack", 2 * 3_600_000),
			pastTile("p2", "fix-tokens", 26 * 60_000),
			pastTile("p3", "design-review", 3 * 86_400_000),
		],
	},
	{
		label: "empty-with-past (0 live, ghost +4)",
		live: [],
		past: [
			pastTile("a", "port-text", 12 * 60_000),
			pastTile("b", "port-icon", 40 * 60_000),
			pastTile("c", "port-button", 5 * 3_600_000),
			pastTile("d", "port-stack", 2 * 86_400_000),
		],
	},
	{
		label: "crowded (9 live + ghost)",
		live: Array.from({ length: 9 }, (_, i) =>
			liveTile(`c${i}`, `session-${i + 1}`, { selected: i === 0 }),
		),
		past: [pastTile("cp", "archived", 3 * 3_600_000)],
	},
];

function DockSpecimen({
	live,
	past,
}: {
	readonly live: readonly DockTile[];
	readonly past: readonly DockTile[];
}) {
	const [expanded, setExpanded] = useState(false);
	const value: SessionDockContextValue = {
		state: { live, past, expanded, nowMs },
		actions: { select: noop, toggleExpanded: () => setExpanded((v) => !v) },
	};
	return (
		<div style={{ position: "relative" }}>
			<SessionDockProvider value={value}>
				<SessionDock />
			</SessionDockProvider>
		</div>
	);
}

const formatUsd = (value: number): string => `$${value.toFixed(2)}`;

const usdAt = (timeSec: number): number => 120 + Math.sin(timeSec / 5) * 30;

const seedUsd = (): LiveLinePoint[] => {
	const base = Math.floor(Date.now() / 1000);
	return Array.from({ length: 30 }, (_, i) => {
		const time = base - (29 - i);
		return { time, value: usdAt(time) };
	});
};

function UsdChartDemo() {
	const [data, setData] = useState<LiveLinePoint[]>(seedUsd);
	const [value, setValue] = useState<number>(() => usdAt(nowSec));
	useEffect(() => {
		const id = setInterval(() => {
			const time = Math.floor(Date.now() / 1000);
			const next = usdAt(time);
			setValue(next);
			setData((prev) => {
				const grown = [...prev, { time, value: next }];
				return grown.length > 60 ? grown.slice(grown.length - 60) : grown;
			});
		}, 1000);
		return () => clearInterval(id);
	}, []);
	return (
		<div style={{ height: 220, width: "100%" }}>
			<LiveLineChart data={data} numXTicks={5} value={value} window={60}>
				<LiveYAxis formatValue={formatUsd} />
				<LiveXAxis />
				<LiveLine dataKey="value" formatValue={formatUsd} />
			</LiveLineChart>
		</div>
	);
}

const pageStyle: CSSProperties = {
	background: "var(--color-kumo-canvas)",
	color: "var(--text-color-kumo-default)",
	minHeight: "100%",
	padding: 48,
};

const specimenStyle: CSSProperties = { maxWidth: 560, width: "100%" };

export function LabPage() {
	return (
		<VStack gap={48} style={pageStyle}>
			<Text as="h1" variant="heading2">
				session-header lab
			</Text>
			{specimens.map((specimen) => (
				<VStack gap={8} key={specimen.label} style={specimenStyle}>
					<Text as="p" size="xs" variant="secondary">
						{specimen.label}
					</Text>
					<SessionHeaderProvider value={specimen.value}>
						<SessionHeader />
					</SessionHeaderProvider>
				</VStack>
			))}
			<Text as="h1" variant="heading2">
				session-dock lab
			</Text>
			{dockSpecimens.map((specimen) => (
				<VStack gap={8} key={specimen.label} style={specimenStyle}>
					<Text as="p" size="xs" variant="secondary">
						{specimen.label}
					</Text>
					<DockSpecimen live={specimen.live} past={specimen.past} />
				</VStack>
			))}
			<Text as="h1" variant="heading2">
				session-work lab
			</Text>
			{workSpecimens.map((specimen) => (
				<VStack gap={8} key={specimen.label} style={specimenStyle}>
					<Text as="p" size="xs" variant="secondary">
						{specimen.label}
					</Text>
					<SessionWorkProvider value={specimen.value}>
						<WorkDetailProvider value={closedDetail}>
							<SessionWork />
						</WorkDetailProvider>
					</SessionWorkProvider>
				</VStack>
			))}
			<Text as="h1" variant="heading2">
				work-detail drawer lab
			</Text>
			{drawerSpecimens.map((specimen) => (
				<VStack gap={8} key={specimen.label} style={specimenStyle}>
					<Text as="p" size="xs" variant="secondary">
						{specimen.label}
					</Text>
					<DrawerSpecimen value={specimen.value} />
				</VStack>
			))}
			<VStack gap={8} style={specimenStyle}>
				<Text as="p" size="xs" variant="secondary">
					chart module — axes + formatUsd
				</Text>
				<UsdChartDemo />
			</VStack>
		</VStack>
	);
}
