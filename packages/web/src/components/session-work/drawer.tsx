/**
 * The work-detail drawer: a fixed, right-side, scrim-less non-modal lens onto
 * one work item — the same three questions the river answers, one level deeper.
 * Composed from base-ui's Drawer parts (Root/Portal/Popup/Close), styled with
 * Kumo tokens. Explicit per-kind body components are selected by the
 * `DetailView` discriminated union; there are no boolean mode props.
 *
 * Non-modal: `modal={false}` plus `initialFocus`/`finalFocus` off, so focus
 * stays where the user is and the live river behind stays interactive. The
 * `container` prop lets /lab portal the drawer into a bounded stage; the app
 * leaves it undefined and gets the real body-portaled fixed drawer.
 */

import { X } from "@phosphor-icons/react";
import { Drawer } from "@base-ui/react/drawer";
import type { TimelineEntry } from "@plot/projection";
import type { TranscriptEntry } from "@plot/session/transcript";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { formatShortAge } from "../../lib/relative-time.js";
import Stack, { VStack } from "../ui/stack.js";
import { Text } from "../ui/text.js";
import { StreamedProse } from "../ui/streamed.js";
import { Caret, dotStyle, type DotKind } from "./atoms.js";
import { DecisionActions } from "./decision-actions.js";
import {
	useWorkDetail,
	type TranscriptPanel,
	type WorkDetailActions,
	type WorkDetailState,
} from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";

const popupStyle: CSSProperties = {
	background: "var(--color-kumo-base)",
	borderLeft: "1px solid var(--color-kumo-hairline)",
	boxShadow: "-16px 0 40px var(--color-kumo-shadow-drop)",
};

const popupClass =
	"fixed inset-y-0 right-0 z-50 flex flex-col w-[400px] max-w-full max-[760px]:w-[92vw] " +
	"transition-[transform,opacity] duration-200 ease-out " +
	"data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full " +
	"data-[starting-style]:opacity-0 data-[ending-style]:opacity-0 " +
	"motion-reduce:!translate-x-0";

const headerStyle: CSSProperties = { padding: "20px 20px 16px" };
const bodyStyle: CSSProperties = {
	flex: "1 1 0%",
	minHeight: 0,
	overflowY: "auto",
	padding: "4px 20px 20px",
};
const footerStyle: CSSProperties = {
	borderTop: "1px solid var(--color-kumo-hairline)",
	padding: "10px 20px",
};
const nowrap: CSSProperties = { whiteSpace: "nowrap" };
const preWrap: CSSProperties = {
	margin: 0,
	minWidth: 0,
	whiteSpace: "pre-wrap",
	wordBreak: "break-word",
};

const headerDot: Record<DetailView["kind"], DotKind> = {
	decision: "attention",
	active: "active",
	settled: "done",
	failed: "attention",
};

function SectionLabel({ children }: { readonly children: ReactNode }) {
	return (
		<Text
			as="span"
			variant="mono-secondary"
			DANGEROUS_style={{ letterSpacing: "0.04em", textTransform: "uppercase" }}
		>
			{children}
		</Text>
	);
}

function DrawerHeader({ view }: { readonly view: DetailView }) {
	return (
		<VStack gap={8} style={headerStyle}>
			<Stack alignCenter between gap={12} style={{ minWidth: 0 }}>
				<Stack alignCenter gap={8} style={{ minWidth: 0 }}>
					<span aria-hidden="true" style={dotStyle(headerDot[view.kind])} />
					<Text as="span" variant="mono-secondary" DANGEROUS_style={nowrap}>
						{view.wordLine}
					</Text>
				</Stack>
				<Drawer.Close
					aria-label="Close work detail"
					className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-kumo-subtle hover:bg-kumo-tint hover:text-kumo-default focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/50"
				>
					<X aria-hidden size={16} />
				</Drawer.Close>
			</Stack>
			<Text as="h2" variant="heading3">
				{view.title}
			</Text>
		</VStack>
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
				<Stack alignStart gap={8} style={{ minWidth: 0 }}>
					<Text as="pre" variant="mono" DANGEROUS_style={preWrap}>
						{view.tool}
					</Text>
					{view.streaming && <Caret />}
				</Stack>
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
		<Stack as="li" alignStart gap={8} style={{ minWidth: 0 }}>
			<Text
				as="span"
				variant="mono-secondary"
				DANGEROUS_style={{ flex: "0 0 42px", textAlign: "right" }}
			>
				{row.kind}
			</Text>
			<Text
				as="span"
				truncate
				variant={last ? "body" : "secondary"}
				DANGEROUS_style={{ flex: "1 1 0%" }}
			>
				{row.text}
			</Text>
			<Text as="span" variant="mono-secondary" DANGEROUS_style={nowrap}>
				{formatShortAge(nowMs - row.atMs)}
			</Text>
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
			<VStack
				as="ul"
				gap={4}
				style={{ listStyle: "none", margin: 0, padding: 0 }}
			>
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
	// Only model text/thinking is markdown; tool-call/tool-result stay plain mono
	// so their JSON and `file_names_with_underscores` render byte-for-byte.
	const llmText = entry.kind === "text" || entry.kind === "thinking";
	return (
		<Stack as="li" alignStart gap={8} style={{ minWidth: 0 }}>
			<Text
				as="span"
				variant="mono-secondary"
				DANGEROUS_style={{ flex: "0 0 42px", textAlign: "right" }}
			>
				{transcriptLabel(entry)}
			</Text>
			<VStack gap={2} style={{ flex: "1 1 0%", minWidth: 0 }}>
				{entry.name !== undefined && (
					<Text as="span" variant="mono-secondary" DANGEROUS_style={preWrap}>
						{entry.name}
					</Text>
				)}
				{llmText ? (
					<StreamedProse text={entry.text} />
				) : (
					<Text as="pre" variant="mono-secondary" DANGEROUS_style={preWrap}>
						{entry.text}
					</Text>
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
		<VStack
			as="ul"
			gap={8}
			style={{ listStyle: "none", margin: 0, padding: 0 }}
		>
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
				className="w-max cursor-pointer rounded bg-transparent text-left font-mono text-sm text-kumo-subtle hover:text-kumo-default focus:outline-none focus-visible:ring-2 focus-visible:ring-kumo-focus/50"
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
		<Stack alignCenter between gap={12} style={footerStyle}>
			{view.factsLine === undefined ? (
				<span />
			) : (
				<Text as="span" variant="mono-secondary" DANGEROUS_style={nowrap}>
					{view.factsLine}
				</Text>
			)}
			<Text as="span" variant="mono-secondary" DANGEROUS_style={nowrap}>
				esc to close
			</Text>
		</Stack>
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
		<Drawer.Root
			modal={false}
			onOpenChange={(next) => {
				if (!next) actions.close();
			}}
			open={open}
			swipeDirection="right"
		>
			<Drawer.Portal container={container ?? undefined}>
				<Drawer.Popup
					className={popupClass}
					finalFocus={false}
					initialFocus={false}
					render={<aside aria-label="Work detail" />}
					style={popupStyle}
				>
					{view !== undefined && (
						<>
							<DrawerHeader view={view} />
							<div onScroll={onBodyScroll} ref={bodyRef} style={bodyStyle}>
								<DrawerBody actions={actions} state={state} view={view} />
							</div>
							<DrawerFooter view={view} />
						</>
					)}
				</Drawer.Popup>
			</Drawer.Portal>
		</Drawer.Root>
	);
}
