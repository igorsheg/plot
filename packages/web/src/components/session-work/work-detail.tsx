/**
 * The work detail — an inline instrument panel (not a floating sheet). The
 * masthead (identity, status, and any decision controls) stays pinned while the
 * narrative and event ticker share the scroll below, so the things you act on
 * never move as a live item updates. Consumes only `useWorkDetail()`; the split
 * layout owns the open/close animation and the panel's width.
 */

import type { TimelineEntry } from "@plot/projection";
import { type ReactNode, useEffect } from "react";
import { formatShortAge } from "../../lib/relative-time.js";
import type { WorkState } from "../ui/icons.js";
import { ArrowUpRightIcon, XIcon } from "../ui/icons.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import Stack, { VStack } from "../ui/stack.js";
import { StreamedProse } from "../ui/streamed.js";
import { Text } from "../ui/text.js";
import { StateIcon } from "./atoms.js";
import { DecisionActions } from "./decision-actions.js";
import { useWorkDetail } from "./detail-context.js";
import {
	formatTokens,
	type DetailMetrics,
	type DetailView,
} from "./detail-view-model.js";

const HEADER_STATE: Record<DetailView["kind"], WorkState> = {
	decision: "attention",
	active: "active",
	settled: "done",
	failed: "canceled",
};

const CHECK: Record<
	"running" | "passed" | "failed",
	{ readonly word: string; readonly tone: "mono-secondary" | "mono-error" }
> = {
	running: { word: "verifying", tone: "mono-secondary" },
	passed: { word: "verify passed", tone: "mono-secondary" },
	failed: { word: "verify failed", tone: "mono-error" },
};

function Rail({ children }: { readonly children: ReactNode }) {
	return (
		<Text as="span" size="sm" variant="mono-secondary">
			{children}
		</Text>
	);
}

/** Who and where: subtitle, labels, and an out-link, on one baseline row. */
function Identity({ view }: { readonly view: DetailView }) {
	return (
		<Stack alignCenter gap={8} wrap>
			{view.subtitle !== undefined && <Rail>{view.subtitle}</Rail>}
			{view.labels.map((label) => (
				<Badge key={label} variant="secondary">
					{label}
				</Badge>
			))}
			{view.url !== undefined && (
				<a
					className="ms-auto inline-flex items-center gap-1 rounded-sm font-mono text-muted-foreground text-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:underline"
					href={view.url}
					rel="noreferrer"
					target="_blank"
				>
					open
					<ArrowUpRightIcon className="size-3.5" />
				</a>
			)}
		</Stack>
	);
}

/** One quiet line: the stage word and the verify state, when there is one. */
function Status({ view }: { readonly view: DetailView }) {
	const check =
		view.check === undefined || view.check === "not-run"
			? undefined
			: CHECK[view.check];
	return (
		<div className="flex items-baseline gap-2">
			<Rail>{view.stage}</Rail>
			{check !== undefined && (
				<>
					<Rail>·</Rail>
					<Text as="span" size="sm" variant={check.tone}>
						{check.word}
					</Text>
				</>
			)}
		</div>
	);
}

/** The one activity view: a dense ring buffer of the latest events. */
function Ticker({
	events,
	nowMs,
}: {
	readonly events: readonly TimelineEntry[];
	readonly nowMs: number;
}) {
	if (events.length === 0) return null;
	const shown = events.slice(-6);
	return (
		<div className="flex flex-col gap-1">
			{shown.map((event, index) => (
				<div
					className="flex items-baseline gap-3"
					key={`${event.atMs}:${index}`}
				>
					<span className="w-12 shrink-0">
						<Text as="span" size="sm" variant="mono-secondary">
							{event.kind}
						</Text>
					</span>
					<Text
						as="p"
						size="sm"
						truncate
						variant={index === shown.length - 1 ? "mono" : "mono-secondary"}
					>
						{event.text}
					</Text>
					<span className="ms-auto shrink-0 ps-3">
						<Text as="span" size="sm" variant="mono-secondary">
							{formatShortAge(nowMs - event.atMs)}
						</Text>
					</span>
				</div>
			))}
		</div>
	);
}

/**
 * The semantic narrative — a decision's reason, or a settled/failed outcome.
 * Shares the scroll region with the ticker, free to grow. Active items speak
 * through the ticker alone.
 */
function Narrative({ view }: { readonly view: DetailView }) {
	switch (view.kind) {
		case "decision":
			return view.reason === undefined ? null : (
				<StreamedProse text={view.reason} />
			);
		case "settled":
			return <StreamedProse text={view.message} />;
		case "failed":
			return <StreamedProse text={view.message} tone="danger" />;
		case "active":
			return null;
	}
}

/** The pinned footer ledger: `turn N · Xk tok · $Y · elapsed`. */
function Metrics({ metrics }: { readonly metrics: DetailMetrics }) {
	const parts = [
		`turn ${metrics.turn}`,
		metrics.tokens === undefined
			? undefined
			: `${formatTokens(metrics.tokens)} tok`,
		metrics.cost === undefined ? undefined : `$${metrics.cost.toFixed(2)}`,
		metrics.elapsed,
	].filter((part): part is string => part !== undefined);
	return (
		<Text as="span" size="sm" variant="mono-secondary">
			{parts.join("  ·  ")}
		</Text>
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
			{/* masthead — pinned chrome (title, metadata, controls) over a hairline
			    that, with the footer's, frames the scrolling log as a well */}
			<VStack
				gap={16}
				style={{
					padding: "24px 24px 16px",
					borderBottom: "1px solid var(--border)",
				}}
			>
				<Stack alignStart between gap={12}>
					<Stack alignCenter gap={8} style={{ minWidth: 0 }}>
						<StateIcon state={HEADER_STATE[view.kind]} />
						<Text as="h2" truncate variant="heading3">
							{view.title}
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
				{/* metadata pair — subtitle/labels and status sit tight together */}
				<VStack gap={8}>
					<Identity view={view} />
					<Status view={view} />
				</VStack>
				{view.kind === "decision" && view.decision.actions.length > 0 && (
					<DecisionActions target={view.decision} />
				)}
			</VStack>
			{/* log — narrative and ticker share the rest, free to grow and scroll */}
			<VStack
				gap={24}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					padding: "8px 24px 24px",
					scrollbarGutter: "stable",
				}}
			>
				<Narrative view={view} />
				<Ticker events={view.events} nowMs={state.nowMs} />
			</VStack>
			<Stack
				alignCenter
				between
				gap={12}
				style={{ padding: "16px 24px", borderTop: "1px solid var(--border)" }}
			>
				<Metrics metrics={view.metrics} />
				<Text as="span" size="sm" variant="mono-secondary">
					esc to close
				</Text>
			</Stack>
		</VStack>
	);
}
