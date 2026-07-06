/**
 * Session work — "one river, no labels". A single column ordered by salience:
 * attention (decisions, failures, diagnostics), then motion (active, queued),
 * then one hairline, then settled work. Order and spacing carry all structure;
 * there are no section headers and no status words. The dot encodes state
 * (solid = active, hollow = queued, red = attention) and the right edge is
 * always time.
 *
 * The root selects explicit item components by discriminated-union kind; there
 * are no boolean mode props. Every item consumes only `useSessionWork()` and
 * (for opening the detail drawer) `useWorkDetail()`. Openable rows — decision,
 * failure, active, settled — are real buttons; queued and diagnostic rows are
 * not. The drawer renders alongside the river and shares both contexts.
 */

import { useStore } from "@nanostores/react";
import type { OperatorObservationInput } from "@plot/session/runtime";
import { type ReactNode } from "react";
import {
	$actOnWork,
	$nowMs,
	$selectedProjection,
	$selectedRun,
	$transcriptQuery,
	$transcriptRef,
} from "../../app/store.js";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../../lib/relative-time.js";
import { Text } from "../ui/text.js";
import { StreamedLine } from "../ui/streamed.js";
import Stack, { VStack } from "../ui/stack.js";
import { Caret, Dot, type DotKind } from "./atoms.js";
import {
	SessionWorkProvider,
	useSessionWork,
	type SessionWorkContextValue,
} from "./context.js";
import { DecisionActions } from "./decision-actions.js";
import {
	WorkDetailProvider,
	useWorkDetail,
	type TranscriptPanel,
	type WorkDetailContextValue,
} from "./detail-context.js";
import {
	closeDetail,
	openDetail,
	stepDetail,
	toggleTranscript,
	$detailView,
} from "./detail-store.js";
import {
	refEquals,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { WorkDrawer } from "./drawer.js";
import {
	buildAttention,
	buildMotion,
	buildSettled,
	decisionCount,
	verifyingLine,
	type AttentionItem,
	type MotionItem,
	type SettledItem,
} from "./view-model.js";

type DecisionItem = Extract<AttentionItem, { kind: "decision" }>;
type FailureItem = Extract<AttentionItem, { kind: "failure" }>;
type DiagnosticItem = Extract<AttentionItem, { kind: "diagnostic" }>;
type ActiveItem = Extract<MotionItem, { kind: "active" }>;
type QueuedItem = Extract<MotionItem, { kind: "queued" }>;

const riverStyle = { maxWidth: "calc(var(--plot-rhythm) * 168)" } as const;
const groupStyle = {
	gap: 18,
	listStyle: "none",
	margin: 0,
	padding: 0,
} as const;
const rowStyle = { minWidth: 0 } as const;
const liStyle = { listStyle: "none", minWidth: 0 } as const;
const edgeStyle = { whiteSpace: "nowrap" } as const;

const openButtonClass =
	"group -mx-2 flex w-full cursor-pointer rounded-md px-2 py-1 text-left " +
	"hover:bg-kumo-tint/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/50";

// Font wrappers for `StreamedLine`: the primitive inherits font-family/size and
// only sets color via `tone`, so each callsite carries the font its row used
// before — mono 12.5px for live/failure lines, sans 13.5px for reason/settled.
const liveLineFont =
	"block min-w-0 max-w-full truncate font-mono text-[12.5px]";
const liveLineFontFlex = "min-w-0 flex-1 truncate font-mono text-[12.5px]";
const reasonLineFont = "block min-w-0 max-w-full truncate text-[13.5px]";
const settledLineFont = "min-w-0 flex-1 truncate text-[13.5px]";

const isOpen = (view: DetailView | undefined, ref: DetailRef): boolean =>
	view !== undefined && refEquals(view.ref, ref);

const workRef = (workKey: string): DetailRef => ({ kind: "work", workKey });

function RowInner({
	dot,
	edge,
	children,
}: {
	readonly dot: DotKind;
	readonly edge?: string | undefined;
	readonly children: ReactNode;
}) {
	return (
		<>
			<Dot kind={dot} />
			<VStack flex1 gap={4} style={rowStyle}>
				{children}
			</VStack>
			{edge !== undefined && (
				<Text as="span" variant="mono-secondary" DANGEROUS_style={edgeStyle}>
					{edge}
				</Text>
			)}
		</>
	);
}

/** A non-interactive row (queued, diagnostic). */
function Row({
	dot,
	edge,
	children,
}: {
	readonly dot: DotKind;
	readonly edge?: string | undefined;
	readonly children: ReactNode;
}) {
	return (
		<Stack as="li" alignStart gap={12} style={rowStyle}>
			<RowInner dot={dot} edge={edge}>
				{children}
			</RowInner>
		</Stack>
	);
}

/** An openable row: the whole row is a button; `footer` renders below it. */
function OpenableRow({
	dot,
	edge,
	open,
	onOpen,
	children,
	footer,
}: {
	readonly dot: DotKind;
	readonly edge?: string | undefined;
	readonly open: boolean;
	readonly onOpen: () => void;
	readonly children: ReactNode;
	readonly footer?: ReactNode;
}) {
	return (
		<li style={liStyle}>
			<button
				aria-expanded={open}
				className={`${openButtonClass} items-start gap-3`}
				onClick={onOpen}
				type="button"
			>
				<RowInner dot={dot} edge={edge}>
					{children}
				</RowInner>
			</button>
			{footer}
		</li>
	);
}

const ageEdge = (
	nowMs: number,
	sinceMs: number | undefined,
): string | undefined =>
	sinceMs === undefined ? undefined : formatShortAge(nowMs - sinceMs);

function DecisionRow({ item }: { readonly item: DecisionItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.workKey);
	return (
		<OpenableRow
			dot="attention"
			edge={ageEdge(state.nowMs, item.sinceMs)}
			footer={
				item.actions.length > 0 ? (
					<Stack style={{ paddingLeft: 20 }}>
						<DecisionActions
							target={{
								sourceId: item.sourceId,
								workKey: item.workKey,
								actions: item.actions,
							}}
						/>
					</Stack>
				) : undefined
			}
			onOpen={() => detail.actions.open(ref)}
			open={isOpen(detail.state.view, ref)}
		>
			<Text as="p" bold>
				{item.title}
			</Text>
			{item.reason !== undefined && (
				<span className={reasonLineFont}>
					<StreamedLine text={item.reason} />
				</span>
			)}
		</OpenableRow>
	);
}

function FailureRow({ item }: { readonly item: FailureItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.key);
	return (
		<OpenableRow
			dot="attention"
			edge={ageEdge(state.nowMs, item.sinceMs)}
			onOpen={() => detail.actions.open(ref)}
			open={isOpen(detail.state.view, ref)}
		>
			<Text as="p" bold>
				{item.title}
			</Text>
			{item.line !== undefined && (
				<span className={liveLineFont}>
					<StreamedLine text={item.line} tone="danger" />
				</span>
			)}
		</OpenableRow>
	);
}

function DiagnosticRow({ item }: { readonly item: DiagnosticItem }) {
	return (
		<Row dot="attention">
			<Text
				as="p"
				DANGEROUS_className="text-kumo-danger"
				truncate
				variant="mono"
			>
				{item.text}
			</Text>
		</Row>
	);
}

function ActiveRow({ item }: { readonly item: ActiveItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.key);
	// The verifying prefix is our injected label, not model text, so a prefixed
	// line renders plain regardless of the underlying stream's origin.
	const line =
		item.line === undefined
			? undefined
			: item.verifying
				? { text: verifyingLine(item.line.text), llm: false }
				: item.line;
	return (
		<OpenableRow
			dot="active"
			edge={ageEdge(state.nowMs, item.sinceMs)}
			onOpen={() => detail.actions.open(ref)}
			open={isOpen(detail.state.view, ref)}
		>
			<Text as="p" bold>
				{item.title}
			</Text>
			{line !== undefined && (
				<Stack alignCenter gap={8} style={rowStyle}>
					{line.llm ? (
						<span className={liveLineFontFlex}>
							<StreamedLine text={line.text} tone="secondary" />
						</span>
					) : (
						<Text as="p" truncate variant="mono-secondary">
							{line.text}
						</Text>
					)}
					{item.streaming && <Caret />}
				</Stack>
			)}
		</OpenableRow>
	);
}

function QueuedRow({ item }: { readonly item: QueuedItem }) {
	const { state } = useSessionWork();
	const edge =
		item.wakeDueAtMs === undefined
			? undefined
			: `wakes in ${formatCountdown(item.wakeDueAtMs - state.nowMs)}`;
	return (
		<Row dot="queued" edge={edge}>
			<Text as="p" variant="secondary">
				{item.title}
			</Text>
			{item.sub !== undefined && (
				<Text as="p" truncate variant="secondary">
					{item.sub}
				</Text>
			)}
		</Row>
	);
}

function AttentionRow({ item }: { readonly item: AttentionItem }) {
	switch (item.kind) {
		case "decision":
			return <DecisionRow item={item} />;
		case "failure":
			return <FailureRow item={item} />;
		case "diagnostic":
			return <DiagnosticRow item={item} />;
	}
}

function MotionRow({ item }: { readonly item: MotionItem }) {
	switch (item.kind) {
		case "active":
			return <ActiveRow item={item} />;
		case "queued":
			return <QueuedRow item={item} />;
	}
}

function SettledRow({ item }: { readonly item: SettledItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref: DetailRef = { kind: "settled", key: item.key };
	const age = formatShortAge(state.nowMs - item.atMs);
	const edge =
		item.durationMs === undefined
			? age
			: `${age} · ${formatDuration(item.durationMs)}`;
	return (
		<li style={liStyle}>
			<button
				aria-expanded={isOpen(detail.state.view, ref)}
				className={`${openButtonClass} items-baseline gap-3`}
				onClick={() => detail.actions.open(ref)}
				type="button"
			>
				<Text as="span" DANGEROUS_style={{ flexShrink: 0 }}>
					{item.label}
				</Text>
				<span className={settledLineFont}>
					<StreamedLine
						text={item.message}
						tone={item.failed ? "danger" : "secondary"}
					/>
				</span>
				<Text as="span" variant="mono-secondary" DANGEROUS_style={edgeStyle}>
					{edge}
				</Text>
			</button>
		</li>
	);
}

/** The only structural line on the page: in-motion above, settled below. */
function Hairline() {
	return (
		<div
			aria-hidden="true"
			style={{ borderTop: "1px solid var(--color-kumo-hairline)" }}
		/>
	);
}

export function SessionWork() {
	const { state } = useSessionWork();
	if (!state.loaded) {
		return (
			<Text as="p" variant="secondary">
				Loading…
			</Text>
		);
	}
	const hasAttention = state.attention.length > 0;
	const hasMotion = state.motion.length > 0;
	const hasSettled = state.settled.length > 0;
	if (!hasAttention && !hasMotion && !hasSettled) {
		return (
			<>
				<Text as="p" variant="secondary">
					Nothing in flight. The workflow decides what runs — watch this space
					or check the workflow file.
				</Text>
				<WorkDrawer />
			</>
		);
	}
	return (
		<VStack gap={40} style={riverStyle}>
			{hasAttention && (
				<VStack as="ul" style={groupStyle}>
					{state.attention.map((item) => (
						<AttentionRow item={item} key={item.key} />
					))}
				</VStack>
			)}
			{hasMotion && (
				<VStack as="ul" style={groupStyle}>
					{state.motion.map((item) => (
						<MotionRow item={item} key={item.key} />
					))}
				</VStack>
			)}
			{(hasAttention || hasMotion) && hasSettled && <Hairline />}
			{hasSettled && (
				<VStack as="ul" style={groupStyle}>
					{state.settled.map((item) => (
						<SettledRow item={item} key={item.key} />
					))}
				</VStack>
			)}
			<WorkDrawer />
		</VStack>
	);
}

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

const act = (input: Omit<OperatorObservationInput, "actor">): void =>
	void $actOnWork.mutate(input);

/**
 * Adapts the app's nanostores into the generic work + detail interfaces. This
 * is the only place session-work touches app state; the rows above never do.
 * Both contexts are stacked here so the public API stays `SessionWork` + this
 * provider, and the drawer (rendered inside `SessionWork`) sees both.
 */
export function StoreSessionWorkProvider({
	children,
}: {
	readonly children: ReactNode;
}) {
	const run = useStore($selectedRun);
	const projection = useStore($selectedProjection);
	const nowMs = useStore($nowMs);
	const actState = useStore($actOnWork);
	const detailView = useStore($detailView);
	const transcriptQuery = useStore($transcriptQuery);
	const transcriptRef = useStore($transcriptRef);
	if (run === undefined) return null;
	const attention = projection === undefined ? [] : buildAttention(projection);
	const acting = actState.loading ?? false;
	const workValue: SessionWorkContextValue = {
		state: {
			nowMs,
			attention,
			motion: projection === undefined ? [] : buildMotion(projection),
			settled: projection === undefined ? [] : buildSettled(projection),
			denseDecisions: decisionCount(attention) >= 3,
			loaded: projection !== undefined,
		},
		actions: { act, acting },
	};
	const transcript: TranscriptPanel = {
		expanded: transcriptRef !== undefined,
		loading: transcriptQuery.loading ?? false,
		entries: (transcriptQuery.data?.entries ?? []).slice(-40),
		notRecorded: transcriptQuery.data?.notRecorded ?? false,
		error:
			transcriptQuery.error === undefined
				? undefined
				: errorText(transcriptQuery.error),
	};
	const detailValue: WorkDetailContextValue = {
		state: { view: detailView, nowMs, transcript },
		actions: {
			open: openDetail,
			close: closeDetail,
			step: stepDetail,
			toggleTranscript,
			act,
			acting,
		},
	};
	return (
		<SessionWorkProvider value={workValue}>
			<WorkDetailProvider value={detailValue}>{children}</WorkDetailProvider>
		</SessionWorkProvider>
	);
}
