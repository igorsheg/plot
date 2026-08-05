/**
 * Session work — the board layout. Same salience vocabulary as the river (see
 * session-work.tsx and work-item.tsx): attention (decisions, failures,
 * diagnostics, sources), active motion, queued/held motion, and settled work.
 * Instead of one salience-ordered column it lays the four groups out as
 * always-visible kanban columns, so nothing is folded below a fold.
 *
 * The surrounding shell owns Workflow selection (dock in the river, tabs on the
 * board); this component only renders one selected Session's work. Like the
 * river, each card consumes only
 * `useSessionWork()` and (to open the drawer) `useWorkDetail()`, and openable
 * cards carry the exact same `DetailRef`s as the river rows — a card opens the
 * same detail drawer as its river twin. The per-kind card logic mirrors the
 * river rows in session-work.tsx (SourceRow/DecisionRow/FailureRow/…), re-derived
 * locally rather than importing those private helpers.
 */

import { type ReactNode } from "react";
import {
	formatCountdown,
	formatDuration,
	formatShortAge,
} from "../../lib/relative-time.js";
import type { WorkState } from "../ui/icons.js";
import { StreamedLine } from "../ui/streamed.js";
import { Text } from "../ui/text.js";
import { StateIcon } from "./atoms.js";
import { useSessionWork } from "./context.js";
import { useWorkDetail } from "./detail-context.js";
import {
	refEquals,
	type DetailRef,
	type DetailView,
} from "./detail-view-model.js";
import { WorkBoard } from "./work-board.js";
import { WorkCard } from "./work-card.js";
import {
	buildBoardColumns,
	subjectCountsText,
	verifyingLine,
	type AttentionItem,
	type MotionItem,
	type SettledItem,
	type SubjectChildState,
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

const ageEdge = (
	nowMs: number,
	sinceMs: number | undefined,
): string | undefined =>
	sinceMs === undefined ? undefined : formatShortAge(nowMs - sinceMs);

/** Footer + edge, only when the card carries time data. */
function EdgeFooter({
	edge,
}: {
	readonly edge: string | undefined;
}): ReactNode {
	if (edge === undefined) return null;
	return (
		<WorkCard.Footer>
			<WorkCard.Meta />
			<WorkCard.Edge>{edge}</WorkCard.Edge>
		</WorkCard.Footer>
	);
}

/**
 * Source readiness as a card. Mirrors SourceRow: a frame that opens the drawer,
 * never an action trigger. The icon and description carry salience — red
 * attention when setup is required, `active` while an action runs, muted `held`
 * when the source is simply unavailable. The "setup" tag shows only when an
 * action is actually required.
 */
function SourceCard({ item }: { readonly item: SourceItem }) {
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
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					{item.status === "action-required" && (
						<WorkCard.Tags>
							<WorkCard.Tag tone="danger">setup</WorkCard.Tag>
						</WorkCard.Tags>
					)}
					<WorkCard.Line>
						<WorkCard.Icon state={iconState} />
						<WorkCard.Title tone={unavailable ? "secondary" : "body"}>
							{item.title}
						</WorkCard.Title>
					</WorkCard.Line>
					{subline !== undefined && (
						<WorkCard.Description
							tone={subline.tone === "danger" ? "error" : "secondary"}
						>
							{subline.text}
						</WorkCard.Description>
					)}
				</WorkCard.Body>
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function DecisionCard({ item }: { readonly item: DecisionItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.workKey);
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					<WorkCard.Tags>
						<WorkCard.Tag tone="danger">decision</WorkCard.Tag>
					</WorkCard.Tags>
					<WorkCard.Line>
						<WorkCard.Icon state="attention" />
						<WorkCard.Title>{item.title}</WorkCard.Title>
					</WorkCard.Line>
					{item.reason !== undefined && (
						<WorkCard.Description>
							<StreamedLine text={item.reason} />
						</WorkCard.Description>
					)}
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function FailureCard({ item }: { readonly item: FailureItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.key);
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					<WorkCard.Tags>
						<WorkCard.Tag tone="danger">failed</WorkCard.Tag>
					</WorkCard.Tags>
					<WorkCard.Line>
						<WorkCard.Icon state="attention" />
						<WorkCard.Title>{item.title}</WorkCard.Title>
					</WorkCard.Line>
					{item.line !== undefined && (
						<WorkCard.Description tone="error">
							{item.line}
						</WorkCard.Description>
					)}
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function DiagnosticCard({ item }: { readonly item: DiagnosticItem }) {
	return (
		<WorkCard.Root>
			<WorkCard.Frame>
				<WorkCard.Body>
					<WorkCard.Line>
						<WorkCard.Icon state="attention" />
						<WorkCard.Title tone="body" truncate>
							{item.text}
						</WorkCard.Title>
					</WorkCard.Line>
				</WorkCard.Body>
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function AttentionCard({ item }: { readonly item: AttentionItem }) {
	switch (item.kind) {
		case "source":
			return <SourceCard item={item} />;
		case "decision":
			return <DecisionCard item={item} />;
		case "failure":
			return <FailureCard item={item} />;
		case "diagnostic":
			return <DiagnosticCard item={item} />;
	}
}

/** The in-motion card carries no tag — the column already says "In motion". */
function ActiveCard({ item }: { readonly item: ActiveItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref = workRef(item.key);
	// Same as ActiveRow: a verifying prefix is our label, not model text, so a
	// prefixed line renders plain regardless of the stream's origin.
	const line =
		item.line === undefined
			? undefined
			: item.verifying
				? { text: verifyingLine(item.line.text), llm: false }
				: item.line;
	const edge = ageEdge(state.nowMs, item.sinceMs);
	return (
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					<WorkCard.Line>
						<WorkCard.Icon state="active" />
						<WorkCard.Title>{item.title}</WorkCard.Title>
					</WorkCard.Line>
					{line !== undefined && (
						<WorkCard.Description>
							{line.llm ? (
								<StreamedLine text={line.text} tone="secondary" />
							) : (
								line.text
							)}
						</WorkCard.Description>
					)}
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function SubjectDots({ item }: { readonly item: SubjectItem }) {
	return (
		<div className="flex min-w-0 items-center gap-1.5">
			<span className="flex shrink-0 items-center gap-0.5" aria-hidden="true">
				{item.dots.map((state: SubjectChildState, index) => (
					<StateIcon
						className="size-3"
						key={`${state}:${index}`}
						state={state}
					/>
				))}
			</span>
			{item.overflow > 0 && (
				<Text as="span" size="sm" variant="secondary">
					+{item.overflow}
				</Text>
			)}
			<Text as="span" size="sm" truncate variant="secondary">
				{subjectCountsText(item.counts)}
			</Text>
		</div>
	);
}

function SubjectGroupCard({ item }: { readonly item: SubjectItem }) {
	const detail = useWorkDetail();
	const ref = subjectRef(item.subjectKey);
	const edge =
		item.progress === undefined
			? undefined
			: `${item.progress.completed}/${item.progress.total} done`;
	const spotlight = item.spotlight;
	const spotlightText =
		spotlight === undefined
			? undefined
			: `${spotlight.title} — ${spotlight.line.text}`;
	return (
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					<WorkCard.Line>
						<WorkCard.Icon state={item.live ? "active" : "queued"} />
						<WorkCard.Title>{item.title}</WorkCard.Title>
					</WorkCard.Line>
					{spotlightText !== undefined && (
						<WorkCard.Description>
							{spotlight?.line.llm === true ? (
								<StreamedLine text={spotlightText} tone="secondary" />
							) : (
								spotlightText
							)}
						</WorkCard.Description>
					)}
					<SubjectDots item={item} />
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function QueuedCard({ item }: { readonly item: QueuedItem }) {
	const { state } = useSessionWork();
	const edge =
		item.wakeDueAtMs === undefined
			? undefined
			: `wakes in ${formatCountdown(item.wakeDueAtMs - state.nowMs)}`;
	return (
		<WorkCard.Root>
			<WorkCard.Frame>
				<WorkCard.Body>
					<WorkCard.Line>
						<WorkCard.Icon state="queued" />
						<WorkCard.Title tone="secondary">{item.title}</WorkCard.Title>
					</WorkCard.Line>
					{item.sub !== undefined && (
						<WorkCard.Description tone="secondary">
							{item.sub}
						</WorkCard.Description>
					)}
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function HeldCard({ item }: { readonly item: HeldItem }) {
	const detail = useWorkDetail();
	const ref = workRef(item.workKey);
	const subline = item.reason ?? item.sub;
	const body = (
		<WorkCard.Body>
			<WorkCard.Line>
				<WorkCard.Icon state="held" />
				<WorkCard.Title tone="secondary">{item.title}</WorkCard.Title>
			</WorkCard.Line>
			{subline !== undefined && (
				<WorkCard.Description tone="secondary">{subline}</WorkCard.Description>
			)}
		</WorkCard.Body>
	);
	if (item.actions.length > 0) {
		return (
			<WorkCard.Root>
				<WorkCard.Frame
					interactive
					onClick={() => detail.actions.open(ref)}
					open={isOpen(detail.state.view, ref)}
				>
					{body}
				</WorkCard.Frame>
			</WorkCard.Root>
		);
	}
	return (
		<WorkCard.Root>
			<WorkCard.Frame>{body}</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function QueuedCards({
	item,
}: {
	readonly item: QueuedItem | HeldItem | SubjectItem;
}) {
	if (item.kind === "queued") return <QueuedCard item={item} />;
	if (item.kind === "held") return <HeldCard item={item} />;
	return <SubjectGroupCard item={item} />;
}

function SettledCard({ item }: { readonly item: SettledItem }) {
	const { state } = useSessionWork();
	const detail = useWorkDetail();
	const ref: DetailRef = { kind: "settled", key: item.key };
	const age = formatShortAge(state.nowMs - item.atMs);
	const edge =
		item.durationMs === undefined
			? age
			: `${age} · ${formatDuration(item.durationMs)}`;
	return (
		<WorkCard.Root>
			<WorkCard.Frame
				interactive
				onClick={() => detail.actions.open(ref)}
				open={isOpen(detail.state.view, ref)}
			>
				<WorkCard.Body>
					<WorkCard.Line>
						<WorkCard.Icon state="history" />
						<WorkCard.Title tone="secondary">{item.label}</WorkCard.Title>
					</WorkCard.Line>
					<WorkCard.Description>
						<StreamedLine
							text={item.message}
							tone={item.failed ? "danger" : "secondary"}
						/>
					</WorkCard.Description>
				</WorkCard.Body>
				<EdgeFooter edge={edge} />
			</WorkCard.Frame>
		</WorkCard.Root>
	);
}

function Column({
	state,
	title,
	count,
	children,
}: {
	readonly state: WorkState;
	readonly title: string;
	readonly count: number;
	readonly children: ReactNode;
}) {
	return (
		<WorkBoard.Column>
			<WorkBoard.ColumnHeader>
				<StateIcon state={state} />
				<WorkBoard.ColumnTitle>{title}</WorkBoard.ColumnTitle>
				<WorkBoard.ColumnCount>{count}</WorkBoard.ColumnCount>
			</WorkBoard.ColumnHeader>
			<WorkBoard.ColumnList>{children}</WorkBoard.ColumnList>
		</WorkBoard.Column>
	);
}

export function SessionBoard() {
	const { state } = useSessionWork();
	if (!state.loaded) {
		return (
			<Text as="p" variant="secondary">
				Loading…
			</Text>
		);
	}
	if (
		state.attention.length === 0 &&
		state.motion.length === 0 &&
		state.settled.length === 0
	) {
		return (
			<Text as="p" variant="secondary">
				Nothing in flight. The workflow decides what runs — watch this space or
				check the workflow file.
			</Text>
		);
	}
	const columns = buildBoardColumns(
		state.motion,
		state.attention,
		state.settled,
	);
	return (
		<WorkBoard.Root>
			<Column
				count={columns.attention.length}
				state="attention"
				title="Attention"
			>
				{columns.attention.map((item) => (
					<AttentionCard item={item} key={item.key} />
				))}
			</Column>
			<Column count={columns.active.length} state="active" title="In motion">
				{columns.active.map((item) =>
					item.kind === "subject-group" ? (
						<SubjectGroupCard item={item} key={item.key} />
					) : (
						<ActiveCard item={item} key={item.key} />
					),
				)}
			</Column>
			<Column count={columns.queued.length} state="queued" title="Queued">
				{columns.queued.map((item) => (
					<QueuedCards item={item} key={item.key} />
				))}
			</Column>
			<Column count={columns.settled.length} state="history" title="Settled">
				{columns.settled.map((item) => (
					<SettledCard item={item} key={item.key} />
				))}
			</Column>
		</WorkBoard.Root>
	);
}
