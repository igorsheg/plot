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
 * (for opening the detail drawer) `useWorkDetail()`. Openable rows — source,
 * decision, failure, active, settled — are real buttons; queued and diagnostic
 * rows are not. The drawer renders alongside the river and shares both contexts.
 */

import { useStore } from "@nanostores/react";
import type { OperatorObservationInput } from "@plot/session/runtime";
import { type ReactNode } from "react";
import {
	$actOnSource,
	$actOnWork,
	$cancelSourceAction,
} from "../../app/actions-store.js";
import { $selectedProjection } from "../../app/projection-store.js";
import { $selectedSession } from "../../app/sessions-store.js";
import { $nowMs } from "../../app/time-store.js";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../../lib/relative-time.js";
import type { WorkState } from "../ui/icons.js";
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
	type WorkDetailContextValue,
} from "./detail-context.js";
import {
	backDetail,
	closeDetail,
	openDetail,
	stepDetail,
	$detailReturn,
	$detailView,
	$openDetail,
} from "./detail-store.js";
import {
	refEquals,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { hairlineClass, groupClass } from "./styles.js";
import {
	buildAttention,
	buildMotion,
	buildSettled,
	decisionCount,
	subjectCountsText,
	subjectTitle,
	verifyingLine,
	type AttentionItem,
	type MotionItem,
	type SettledItem,
} from "./view-model.js";

type SourceItem = Extract<AttentionItem, { kind: "source" }>;
type DecisionItem = Extract<AttentionItem, { kind: "decision" }>;
type FailureItem = Extract<AttentionItem, { kind: "failure" }>;
type DiagnosticItem = Extract<AttentionItem, { kind: "diagnostic" }>;
type ActiveItem = Extract<MotionItem, { kind: "active" }>;
type QueuedItem = Extract<MotionItem, { kind: "queued" }>;
type HeldItem = Extract<MotionItem, { kind: "held" }>;
type SubjectItem = Extract<MotionItem, { kind: "subject-group" }>;

const isOpen = (view: DetailView | undefined, ref: DetailRef): boolean =>
	view !== undefined && refEquals(view.ref, ref);

const workRef = (workKey: string): DetailRef => ({ kind: "work", workKey });

const sourceRef = (sourceId: string): DetailRef => ({
	kind: "source",
	sourceId,
});

const subjectRef = (subjectKey: string): DetailRef => ({
	kind: "subject",
	subjectKey,
});

function EmptySubline() {
	return <WorkItem.Subline empty />;
}

const ageEdge = (
	nowMs: number,
	sinceMs: number | undefined,
): string | undefined =>
	sinceMs === undefined ? undefined : formatShortAge(nowMs - sinceMs);

/**
 * Source readiness in the river. Like a decision, the row is a frame that opens
 * the drawer — never an action trigger; all mutation lives in the drawer. The
 * icon and subline carry salience: red attention when setup is required, a
 * half-circle while an action runs (the row must not leave the group mid-flow),
 * muted `held` when the source is simply unavailable.
 */
function SourceRow({ item }: { readonly item: SourceItem }) {
	const detail = useWorkDetail();
	const ref = sourceRef(item.sourceId);
	const unavailable = item.status === "unavailable";
	const running = item.actionStatus === "running";
	const failedProgress =
		item.actionStatus === "failed" ? item.progress : undefined;
	const iconState: WorkState = unavailable
		? "held"
		: running
			? "active"
			: "attention";
	const subline:
		| { text: string; tone: "default" | "secondary" | "danger" }
		| undefined = unavailable
		? item.message === undefined
			? undefined
			: { text: item.message, tone: "secondary" }
		: running
			? { text: item.progress ?? "Working…", tone: "secondary" }
			: failedProgress !== undefined
				? { text: failedProgress, tone: "danger" }
				: item.message === undefined
					? undefined
					: { text: item.message, tone: "default" };
	return (
		<WorkItem.Root>
			<WorkItem.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Line>
					<WorkItem.Icon state={iconState} />
					<WorkItem.Title tone={unavailable ? "secondary" : "body"}>
						{item.title}
					</WorkItem.Title>
				</WorkItem.Line>
				{subline !== undefined ? (
					<WorkItem.Subline>
						<StreamedLine text={subline.text} tone={subline.tone} />
					</WorkItem.Subline>
				) : (
					<EmptySubline />
				)}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

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
				<WorkItem.Line>
					<WorkItem.Icon state="attention" />
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
				</WorkItem.Line>
				{item.reason !== undefined ? (
					<WorkItem.Subline>
						<StreamedLine text={item.reason} />
					</WorkItem.Subline>
				) : (
					<EmptySubline />
				)}
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
				<WorkItem.Line>
					<WorkItem.Icon state="attention" />
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
				</WorkItem.Line>
				{item.line !== undefined ? (
					<WorkItem.Subline>
						<StreamedLine text={item.line} tone="danger" />
					</WorkItem.Subline>
				) : (
					<EmptySubline />
				)}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function DiagnosticRow({ item }: { readonly item: DiagnosticItem }) {
	return (
		<WorkItem.Root>
			<WorkItem.Frame>
				<WorkItem.Line>
					<WorkItem.Icon state="attention" />
					<WorkItem.Title tone="error" truncate>
						{item.text}
					</WorkItem.Title>
				</WorkItem.Line>
				<EmptySubline />
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
				<WorkItem.Line>
					<WorkItem.Icon state="active" />
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
				</WorkItem.Line>
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
				<WorkItem.Line>
					<WorkItem.Icon state="queued" />
					<WorkItem.Title tone="secondary">{item.title}</WorkItem.Title>
					{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
				</WorkItem.Line>
				{item.sub !== undefined ? (
					<WorkItem.Subline tone="secondary">{item.sub}</WorkItem.Subline>
				) : (
					<EmptySubline />
				)}
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function HeldRow({ item }: { readonly item: HeldItem }) {
	const detail = useWorkDetail();
	const ref = workRef(item.workKey);
	const subline = item.reason ?? item.sub;
	const body = (
		<>
			<WorkItem.Line>
				<WorkItem.Icon state="held" />
				<WorkItem.Title tone="secondary">{item.title}</WorkItem.Title>
			</WorkItem.Line>
			{subline !== undefined ? (
				<WorkItem.Subline tone="secondary">{subline}</WorkItem.Subline>
			) : (
				<EmptySubline />
			)}
		</>
	);
	if (item.actions.length > 0) {
		return (
			<WorkItem.Root>
				<WorkItem.Frame
					interactive
					onClick={() => detail.actions.open(ref)}
					open={isOpen(detail.state.view, ref)}
				>
					{body}
				</WorkItem.Frame>
			</WorkItem.Root>
		);
	}
	return (
		<WorkItem.Root>
			<WorkItem.Frame>{body}</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function AttentionRow({ item }: { readonly item: AttentionItem }) {
	switch (item.kind) {
		case "source":
			return <SourceRow item={item} />;
		case "decision":
			return <DecisionRow item={item} />;
		case "failure":
			return <FailureRow item={item} />;
		case "diagnostic":
			return <DiagnosticRow item={item} />;
	}
}

function SubjectRow({ item }: { readonly item: SubjectItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = subjectRef(item.subjectKey);
	const edge =
		item.progress === undefined
			? ageEdge(state.nowMs, item.sinceMs)
			: `${item.progress.completed}/${item.progress.total}`;
	const spotlight = item.spotlight;
	const line =
		spotlight === undefined
			? subjectCountsText(item.counts)
			: `${spotlight.title} — ${spotlight.line.text}`;
	return (
		<WorkItem.Root>
			<WorkItem.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkItem.Line>
					<WorkItem.Icon state={item.live ? "active" : "queued"} />
					<WorkItem.Title>{item.title}</WorkItem.Title>
					{edge !== undefined && <WorkItem.Edge>{edge}</WorkItem.Edge>}
				</WorkItem.Line>
				<WorkItem.Subline tone="secondary">
					{spotlight?.line.llm === true ? (
						<StreamedLine text={line} tone="secondary" />
					) : (
						line
					)}
				</WorkItem.Subline>
			</WorkItem.Frame>
		</WorkItem.Root>
	);
}

function MotionRow({ item }: { readonly item: MotionItem }) {
	switch (item.kind) {
		case "active":
			return <ActiveRow item={item} />;
		case "queued":
			return <QueuedRow item={item} />;
		case "held":
			return <HeldRow item={item} />;
		case "subject-group":
			return <SubjectRow item={item} />;
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
				<WorkItem.Line>
					<WorkItem.Icon state="history" />
					<WorkItem.Label>{item.label}</WorkItem.Label>
					<WorkItem.Message>
						<StreamedLine
							text={item.message}
							tone={item.failed ? "danger" : "secondary"}
						/>
					</WorkItem.Message>
					<WorkItem.Edge>{edge}</WorkItem.Edge>
				</WorkItem.Line>
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
			<Text as="p" variant="secondary">
				Nothing in flight. The workflow decides what runs — watch this space or
				check the workflow file.
			</Text>
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
		</VStack>
	);
}

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
	const session = useStore($selectedSession);
	const projection = useStore($selectedProjection);
	const nowMs = useStore($nowMs);
	const actState = useStore($actOnWork);
	const sourceActionState = useStore($actOnSource);
	const sourceCancelState = useStore($cancelSourceAction);
	const detailView = useStore($detailView);
	const openDetailRef = useStore($openDetail);
	const detailReturn = useStore($detailReturn);
	if (session === undefined) return null;
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
		actions: {
			act,
			actOnSource: (input) => void $actOnSource.mutate(input),
			cancelSourceAction: (actionRunId) =>
				void $cancelSourceAction.mutate(actionRunId),
			acting:
				acting ||
				(sourceActionState.loading ?? false) ||
				(sourceCancelState.loading ?? false),
		},
	};
	const returnSubject =
		detailReturn?.kind === "subject" && projection !== undefined
			? projection.subjects[detailReturn.subjectKey]
			: undefined;
	const detailValue: WorkDetailContextValue = {
		state: {
			open: openDetailRef !== undefined,
			view: detailView,
			nowMs,
			returnRef: detailReturn,
			returnTitle:
				returnSubject === undefined ? undefined : subjectTitle(returnSubject),
		},
		actions: {
			open: openDetail,
			back: backDetail,
			close: closeDetail,
			step: stepDetail,
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
