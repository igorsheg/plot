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
import { $actOnWork } from "../../app/actions-store.js";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedRun } from "../../app/runs-store.js";
import { $nowMs } from "../../app/time-store.js";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../../lib/relative-time.js";
import { Text } from "../ui/text.js";
import { StreamedLine } from "../ui/streamed.js";
import { VStack } from "../ui/stack.js";
import { WorkItem } from "./work-item.js";
import {
	SessionWorkProvider,
	useSessionWork,
	type SessionWorkContextValue,
} from "./context.js";
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
	$transcriptQuery,
	$transcriptRef,
} from "./detail-store.js";
import {
	refEquals,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { WorkDrawer } from "./drawer.js";
import { hairlineClass, groupClass } from "./styles.js";
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

const isOpen = (view: DetailView | undefined, ref: DetailRef): boolean =>
	view !== undefined && refEquals(view.ref, ref);

const workRef = (workKey: string): DetailRef => ({ kind: "work", workKey });

function EmptySubline() {
	return <WorkItem.Subline empty />;
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
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkItem.Root>
			<WorkItem.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Dot kind="attention" />
				<WorkItem.Body>
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{item.reason !== undefined ? (
						<WorkItem.Subline>
							<StreamedLine text={item.reason} />
						</WorkItem.Subline>
					) : (
						<EmptySubline />
					)}
				</WorkItem.Body>
				{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function FailureRow({ item }: { readonly item: FailureItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.key);
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkItem.Root>
			<WorkItem.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Dot kind="attention" />
				<WorkItem.Body>
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{item.line !== undefined ? (
						<WorkItem.Subline>
							<StreamedLine text={item.line} tone="danger" />
						</WorkItem.Subline>
					) : (
						<EmptySubline />
					)}
				</WorkItem.Body>
				{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function DiagnosticRow({ item }: { readonly item: DiagnosticItem }) {
	return (
		<WorkItem.Root>
			<WorkItem.Frame>
				<WorkItem.Dot kind="attention" />
				<WorkItem.Body>
					<WorkItem.Title tone="error" truncate>
						{item.text}
					</WorkItem.Title>
					<EmptySubline />
				</WorkItem.Body>
			</WorkItem.Frame>
		</WorkItem.Root>
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
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkItem.Root>
			<WorkItem.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Dot kind="active" />
				<WorkItem.Body>
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{line !== undefined ? (
						<WorkItem.Subline>
							{line.llm ? (
								<StreamedLine text={line.text} tone="secondary" />
							) : (
								line.text
							)}
						</WorkItem.Subline>
					) : (
						<EmptySubline />
					)}
				</WorkItem.Body>
				{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function QueuedRow({ item }: { readonly item: QueuedItem }) {
	const { state } = useSessionWork();
	const edge =
		item.wakeDueAtMs === undefined
			? undefined
			: `wakes in ${formatCountdown(item.wakeDueAtMs - state.nowMs)}`;
	return (
		<WorkItem.Root>
			<WorkItem.Frame>
				<WorkItem.Dot kind="queued" />
				<WorkItem.Body>
					<WorkItem.Title tone="secondary">{item.title}</WorkItem.Title>
					{item.sub !== undefined ? (
						<WorkItem.Subline tone="secondary">{item.sub}</WorkItem.Subline>
					) : (
						<EmptySubline />
					)}
				</WorkItem.Body>
				{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
			</WorkItem.Frame>
		</WorkItem.Root>
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
		<WorkItem.Root>
			<WorkItem.Frame
				density="settled"
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Label>{item.label}</WorkItem.Label>
				<WorkItem.Message>
					<StreamedLine
						text={item.message}
						tone={item.failed ? "danger" : "secondary"}
					/>
				</WorkItem.Message>
				<WorkItem.Edge>{edge}</WorkItem.Edge>
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

/** The only structural line on the page: in-motion above, settled below. */
function Hairline() {
	return <div aria-hidden="true" className={hairlineClass()} />;
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
		<VStack gap={20}>
			{hasAttention && (
				<VStack as="ul" className={groupClass()}>
					{state.attention.map((item) => (
						<AttentionRow item={item} key={item.key} />
					))}
				</VStack>
			)}
			{hasMotion && (
				<VStack as="ul" className={groupClass()}>
					{state.motion.map((item) => (
						<MotionRow item={item} key={item.key} />
					))}
				</VStack>
			)}
			{(hasAttention || hasMotion) && hasSettled && <Hairline />}
			{hasSettled && (
				<VStack as="ul" className={groupClass()}>
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
