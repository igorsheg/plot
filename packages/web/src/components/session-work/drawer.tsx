/**
 * The work-detail drawer: a fixed, right-side, scrim-less non-modal lens onto
 * one work item — the same three questions the river answers, one level deeper.
 * Composed from Coss Sheet primitives with Plot's scrim-less styling.
 * Explicit per-kind body components are selected by the `DetailView`
 * discriminated union; there are no boolean mode props.
 *
 * Non-modal: `modal={false}` plus `initialFocus`/`finalFocus` off, so focus
 * stays where the user is and the live river behind stays interactive.
 */

import { XIcon } from "@phosphor-icons/react";
import { Button } from "../ui/button.js";
import {
	Sheet,
	SheetClose,
	SheetFooter,
	SheetHeader,
	SheetPopup,
	SheetTitle,
} from "../ui/sheet.js";
import type { TimelineEntry } from "@plot/projection";
import type { TranscriptEntry } from "@plot/session/transcript";
import { useEffect, useRef, type ReactNode } from "react";
import { formatShortAge } from "../../lib/relative-time.js";
import Stack, { VStack } from "../ui/stack.js";
import { Text, textVariants } from "../ui/text.js";
import { StreamedProse } from "../ui/streamed.js";
import { dotClass, type DotKind } from "./atoms.js";
import { DecisionActions } from "./decision-actions.js";
import {
	useWorkDetail,
	type TranscriptPanel,
	type WorkDetailActions,
	type WorkDetailState,
} from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";
import {
	drawerBodyClass,
	drawerFooterClass,
	drawerHeaderRowClass,
	nowrapClass,
	preWrapClass,
	timelineLabelClass,
	timelineListClass,
	timelineRowClass,
	timelineTextClass,
	transcriptEntryBodyClass,
	transcriptToggleClass,
} from "./styles.js";

const headerDot: Record<DetailView["kind"], DotKind> = {
	decision: "attention",
	active: "active",
	settled: "done",
	failed: "attention",
};

function SectionLabel({ children }: { readonly children: ReactNode }) {
	return (
		<Text as="span" size="sm" variant="secondary">
			{children}
		</Text>
	);
}

function DrawerHeader({ view }: { readonly view: DetailView }) {
	return (
		<SheetHeader>
			<Stack alignCenter between gap={12} className={drawerHeaderRowClass()}>
				<Stack alignCenter gap={8} className={drawerHeaderRowClass()}>
					<span
						aria-hidden="true"
						className={dotClass({ kind: headerDot[view.kind] })}
					/>
					<span className={nowrapClass()}>
						<Text as="span" size="sm" variant="secondary">
							{view.wordLine}
						</Text>
					</span>
				</Stack>
				<SheetClose
					aria-label="Close work detail"
					render={<Button size="icon" variant="ghost" />}
				>
					<XIcon aria-hidden />
				</SheetClose>
			</Stack>
			<SheetTitle>{view.title}</SheetTitle>
		</SheetHeader>
	);
}

function DecisionBody({
	view,
}: {
	readonly view: Extract<DetailView, { kind: "decision" }>;
}) {
	return (
		<VStack gap={12}>
			{view.reason !== undefined && <StreamedProse text={view.reason} />}
			{view.decision.actions.length > 0 && (
				<DecisionActions target={view.decision} />
			)}
		</VStack>
	);
}

function ActiveBody({
	view,
}: {
	readonly view: Extract<DetailView, { kind: "active" }>;
}) {
	return (
		<VStack gap={12}>
			<SectionLabel>Now</SectionLabel>
			{view.tool !== undefined && (
				<pre
					className={preWrapClass({
						className: textVariants({ size: "sm" }),
					})}
				>
					{view.tool}
				</pre>
			)}
			{view.thinking !== undefined && <StreamedProse text={view.thinking} />}
		</VStack>
	);
}

function SettledBody({
	view,
}: {
	readonly view: Extract<DetailView, { kind: "settled" }>;
}) {
	return <StreamedProse text={view.message} />;
}

function FailedBody({
	view,
}: {
	readonly view: Extract<DetailView, { kind: "failed" }>;
}) {
	return <StreamedProse text={view.message} tone="danger" />;
}

function PrimaryBlock({ view }: { readonly view: DetailView }) {
	switch (view.kind) {
		case "decision":
			return <DecisionBody view={view} />;
		case "active":
			return <ActiveBody view={view} />;
		case "settled":
			return <SettledBody view={view} />;
		case "failed":
			return <FailedBody view={view} />;
	}
}

function TimelineRowView({
	row,
	nowMs,
	last,
}: {
	readonly row: TimelineEntry;
	readonly nowMs: number;
	readonly last: boolean;
}) {
	return (
		<Stack as="li" alignStart gap={8} className={timelineRowClass()}>
			<span className={timelineLabelClass()}>
				<Text as="span" size="sm" variant="secondary">
					{row.kind}
				</Text>
			</span>
			<span className={timelineTextClass()}>
				<Text as="span" truncate variant={last ? "body" : "secondary"}>
					{row.text}
				</Text>
			</span>
			<span className={nowrapClass()}>
				<Text as="span" size="sm" variant="secondary">
					{formatShortAge(nowMs - row.atMs)}
				</Text>
			</span>
		</Stack>
	);
}

function TimelineSection({
	rows,
	nowMs,
}: {
	readonly rows: readonly TimelineEntry[];
	readonly nowMs: number;
}) {
	if (rows.length === 0) return null;
	return (
		<VStack gap={8}>
			<SectionLabel>Timeline</SectionLabel>
			<VStack as="ul" gap={4} className={timelineListClass()}>
				{rows.map((row, index) => (
					<TimelineRowView
						key={`${row.atMs}:${index}`}
						last={index === rows.length - 1}
						nowMs={nowMs}
						row={row}
					/>
				))}
			</VStack>
		</VStack>
	);
}

const transcriptLabel = (entry: TranscriptEntry): string => {
	if (entry.kind === "thinking") return "think";
	if (entry.kind === "tool-call" || entry.kind === "tool-result") return "tool";
	return entry.role === "user" ? "user" : "text";
};

function TranscriptEntryView({ entry }: { readonly entry: TranscriptEntry }) {
	// Only model text/thinking is markdown; tool-call/tool-result stay plain text
	// so their JSON and `file_names_with_underscores` render byte-for-byte.
	const llmText = entry.kind === "text" || entry.kind === "thinking";
	return (
		<Stack as="li" alignStart gap={8} className={timelineRowClass()}>
			<span className={timelineLabelClass()}>
				<Text as="span" size="sm" variant="secondary">
					{transcriptLabel(entry)}
				</Text>
			</span>
			<VStack gap={2} className={transcriptEntryBodyClass()}>
				{entry.name !== undefined && (
					<span
						className={preWrapClass({
							className: textVariants({
								variant: "secondary",
								size: "sm",
							}),
						})}
					>
						{entry.name}
					</span>
				)}
				{llmText ? (
					<StreamedProse text={entry.text} />
				) : (
					<pre
						className={preWrapClass({
							className: textVariants({
								variant: "secondary",
								size: "sm",
							}),
						})}
					>
						{entry.text}
					</pre>
				)}
			</VStack>
		</Stack>
	);
}

function TranscriptBody({
	transcript,
}: {
	readonly transcript: TranscriptPanel;
}) {
	if (transcript.loading) {
		return (
			<Text as="p" variant="secondary">
				loading…
			</Text>
		);
	}
	if (transcript.error !== undefined) {
		return (
			<Text as="p" variant="error">
				{transcript.error}
			</Text>
		);
	}
	if (transcript.notRecorded || transcript.entries.length === 0) {
		return (
			<Text as="p" variant="secondary">
				no transcript recorded
			</Text>
		);
	}
	return (
		<VStack as="ul" gap={8} className={timelineListClass()}>
			{transcript.entries.map((entry, index) => (
				<TranscriptEntryView entry={entry} key={index} />
			))}
		</VStack>
	);
}

function TranscriptSection({
	transcript,
	onToggle,
}: {
	readonly transcript: TranscriptPanel;
	readonly onToggle: () => void;
}) {
	return (
		<VStack gap={8}>
			<button
				className={transcriptToggleClass()}
				onClick={onToggle}
				type="button"
			>
				{transcript.expanded ? "hide transcript ↑" : "show transcript tail ↓"}
			</button>
			{transcript.expanded && <TranscriptBody transcript={transcript} />}
		</VStack>
	);
}

function DrawerFooter({ view }: { readonly view: DetailView }) {
	return (
		<SheetFooter>
			<Stack alignCenter between gap={12} className={drawerFooterClass()}>
				{view.factsLine === undefined ? (
					<span />
				) : (
					<span className={nowrapClass()}>
						<Text as="span" size="sm" variant="secondary">
							{view.factsLine}
						</Text>
					</span>
				)}
				<span className={nowrapClass()}>
					<Text as="span" size="sm" variant="secondary">
						esc to close
					</Text>
				</span>
			</Stack>
		</SheetFooter>
	);
}

function DrawerBody({
	view,
	state,
	actions,
}: {
	readonly view: DetailView;
	readonly state: WorkDetailState;
	readonly actions: WorkDetailActions;
}) {
	return (
		<VStack gap={24}>
			<PrimaryBlock view={view} />
			<TimelineSection nowMs={state.nowMs} rows={view.timeline} />
			<TranscriptSection
				onToggle={actions.toggleTranscript}
				transcript={state.transcript}
			/>
		</VStack>
	);
}

const isEditableTarget = (): boolean => {
	const focused = document.activeElement;
	return (
		focused instanceof HTMLElement &&
		(focused.tagName === "INPUT" ||
			focused.tagName === "TEXTAREA" ||
			focused.isContentEditable)
	);
};

export function WorkDrawer({
	container,
}: {
	readonly container?: HTMLElement | null;
}) {
	const { state, actions } = useWorkDetail();
	const view = state.view;
	const open = view !== undefined;
	const bodyRef = useRef<HTMLDivElement | null>(null);
	const stuckRef = useRef(true);

	// While open, ↑/↓ walk the prev/next openable item (same input-guard as the
	// dock's ⌘1–9). Don't intercept when closed or focus is in an input.
	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
				return;
			if (isEditableTarget()) return;
			event.preventDefault();
			actions.step(event.key === "ArrowDown" ? 1 : -1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, actions]);

	// Auto-stick the body to the bottom as new entries append, but only while
	// the user is already at the bottom (terminal convention).
	useEffect(() => {
		const element = bodyRef.current;
		if (element !== null && stuckRef.current)
			element.scrollTop = element.scrollHeight;
	});

	const onBodyScroll = () => {
		const element = bodyRef.current;
		if (element === null) return;
		stuckRef.current =
			element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
	};

	return (
		<Sheet
			modal={false}
			onOpenChange={(next) => {
				if (!next) actions.close();
			}}
			open={open}
		>
			<SheetPopup
				finalFocus={false}
				initialFocus={false}
				portalProps={{ container: container ?? undefined }}
				render={<aside aria-label="Work detail" />}
				showBackdrop={false}
				showCloseButton={false}
				side="right"
			>
				{view !== undefined && (
					<>
						<DrawerHeader view={view} />
						<div
							className={drawerBodyClass()}
							data-slot="sheet-panel"
							onScroll={onBodyScroll}
							ref={bodyRef}
						>
							<DrawerBody actions={actions} state={state} view={view} />
						</div>
						<DrawerFooter view={view} />
					</>
				)}
			</SheetPopup>
		</Sheet>
	);
}
