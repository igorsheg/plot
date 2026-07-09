/**
 * The work detail — an inline panel (not a floating sheet). Renders the open
 * `DetailView`: a status header, the per-kind primary block, the timeline, and a
 * collapsible transcript. Consumes only `useWorkDetail()`; the surrounding split
 * layout owns the open/close animation and the panel's width.
 */

import type { TimelineEntry } from "@plot/projection";
import type { TranscriptEntry } from "@plot/session/transcript";
import { type ReactNode, useEffect } from "react";
import { cn } from "../../lib/utils.js";
import { formatShortAge } from "../../lib/relative-time.js";
import type { WorkState } from "../ui/icons.js";
import { XIcon } from "../ui/icons.js";
import { Button } from "../ui/button.js";
import Stack, { VStack } from "../ui/stack.js";
import { StreamedProse } from "../ui/streamed.js";
import { Text, textVariants } from "../ui/text.js";
import { StateIcon } from "./atoms.js";
import { DecisionActions } from "./decision-actions.js";
import { useWorkDetail, type TranscriptPanel } from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";

const HEADER_STATE: Record<DetailView["kind"], WorkState> = {
	decision: "attention",
	active: "active",
	settled: "done",
	failed: "canceled",
};

const GUTTER = 56;

function Pre({ children }: { readonly children: ReactNode }) {
	return (
		<pre
			className={cn(
				"m-0 min-w-0 whitespace-pre-wrap break-words",
				textVariants({ variant: "mono-secondary", size: "sm" }),
			)}
		>
			{children}
		</pre>
	);
}

function PrimaryBlock({ view }: { readonly view: DetailView }) {
	switch (view.kind) {
		case "decision":
			return (
				<VStack gap={16}>
					{view.reason !== undefined && <StreamedProse text={view.reason} />}
					{view.decision.actions.length > 0 && (
						<DecisionActions target={view.decision} />
					)}
				</VStack>
			);
		case "active":
			return (
				<VStack gap={12}>
					<Text variant="label">Now</Text>
					{view.tool !== undefined && <Pre>{view.tool}</Pre>}
					{view.thinking !== undefined && (
						<StreamedProse text={view.thinking} />
					)}
				</VStack>
			);
		case "settled":
			return <StreamedProse text={view.message} />;
		case "failed":
			return <StreamedProse text={view.message} tone="danger" />;
	}
}

function Timeline({
	rows,
	nowMs,
}: {
	readonly rows: readonly TimelineEntry[];
	readonly nowMs: number;
}) {
	if (rows.length === 0) return null;
	return (
		<VStack gap={8}>
			<Text variant="label">Timeline</Text>
			<VStack
				as="ul"
				gap={8}
				style={{ listStyle: "none", margin: 0, padding: 0 }}
			>
				{rows.map((row, index) => (
					<Stack as="li" alignStart gap={12} key={`${row.atMs}:${index}`}>
						<span style={{ width: GUTTER, flexShrink: 0 }}>
							<Text as="span" variant="mono-secondary" size="sm">
								{row.kind}
							</Text>
						</span>
						<span style={{ flex: 1, minWidth: 0 }}>
							<Text
								as="span"
								size="sm"
								truncate
								variant={index === rows.length - 1 ? "body" : "secondary"}
							>
								{row.text}
							</Text>
						</span>
						<Text as="span" variant="mono-secondary" size="sm">
							{formatShortAge(nowMs - row.atMs)}
						</Text>
					</Stack>
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
	// Only model text/thinking is markdown; tool call/result stay plain so their
	// JSON and `file_names_with_underscores` render byte-for-byte.
	const llmText = entry.kind === "text" || entry.kind === "thinking";
	return (
		<Stack as="li" alignStart gap={12} style={{ minWidth: 0 }}>
			<span style={{ width: GUTTER, flexShrink: 0 }}>
				<Text as="span" variant="mono-secondary" size="sm">
					{transcriptLabel(entry)}
				</Text>
			</span>
			<VStack gap={2} style={{ flex: 1, minWidth: 0 }}>
				{entry.name !== undefined && <Pre>{entry.name}</Pre>}
				{llmText ? (
					<StreamedProse text={entry.text} />
				) : (
					<Pre>{entry.text}</Pre>
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
	if (transcript.loading) return <Text variant="secondary">loading…</Text>;
	if (transcript.error !== undefined)
		return <Text variant="error">{transcript.error}</Text>;
	if (transcript.notRecorded || transcript.entries.length === 0)
		return <Text variant="secondary">no transcript recorded</Text>;
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
				className={cn(
					"w-max cursor-pointer rounded bg-transparent text-left hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
					textVariants({ variant: "secondary", size: "sm" }),
				)}
				onClick={onToggle}
				type="button"
			>
				{transcript.expanded ? "hide transcript ↑" : "show transcript tail ↓"}
			</button>
			{transcript.expanded && <TranscriptBody transcript={transcript} />}
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

export function WorkDetail() {
	const { state, actions } = useWorkDetail();
	const view = state.view;

	// While open, Esc closes and ↑/↓ walk to the prev/next openable item.
	useEffect(() => {
		if (view === undefined) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				actions.close();
				return;
			}
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
				return;
			if (isEditableTarget()) return;
			event.preventDefault();
			actions.step(event.key === "ArrowDown" ? 1 : -1);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [view, actions]);

	if (view === undefined) return null;
	return (
		<VStack aria-label="Work detail" as="aside" style={{ height: "100%" }}>
			<Stack alignStart between gap={12} style={{ padding: "20px 24px 12px" }}>
				<Stack alignCenter gap={8} style={{ minWidth: 0 }}>
					<StateIcon state={HEADER_STATE[view.kind]} />
					<Text as="span" truncate variant="secondary" size="sm">
						{view.wordLine}
					</Text>
				</Stack>
				<Button
					aria-label="Close work detail"
					onClick={actions.close}
					size="icon"
					variant="ghost"
				>
					<XIcon aria-hidden />
				</Button>
			</Stack>
			<VStack
				gap={24}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					padding: "4px 24px 24px",
					scrollbarGutter: "stable",
				}}
			>
				<Text as="h2" variant="heading3">
					{view.title}
				</Text>
				<PrimaryBlock view={view} />
				<Timeline nowMs={state.nowMs} rows={view.timeline} />
				<TranscriptSection
					onToggle={actions.toggleTranscript}
					transcript={state.transcript}
				/>
			</VStack>
			<Stack
				alignCenter
				between
				gap={12}
				style={{ padding: "12px 24px", borderTop: "1px solid var(--border)" }}
			>
				<Text as="span" variant="mono-secondary" size="sm">
					{view.factsLine ?? ""}
				</Text>
				<Text as="span" variant="secondary" size="sm">
					esc to close
				</Text>
			</Stack>
		</VStack>
	);
}
