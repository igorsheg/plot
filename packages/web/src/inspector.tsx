import type {
	SerializedAgentAttemptProjection,
	TimelineEntry,
	WorkItemProjection,
} from "@plot/session/projection";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ObservationInput, WebDashboardProjection } from "./api.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Dot } from "./components/ui/dot.js";
import { Kbd } from "./components/ui/kbd.js";
import {
	ScrollArea,
	ScrollAreaPrimitive,
	ScrollBar,
} from "./components/ui/scroll-area.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { cn } from "./lib/utils.js";
import { TranscriptView } from "./transcript-view.js";
import {
	kindGlyph,
	stageVariant,
	workOperatorActions,
	type WorkOperatorAction,
} from "./work-card.js";

/** Display-side tail of a turn-scoped stream; the reducer owns the real window. */
const streamTail = (text: string): string =>
	text.length > 2000 ? `…${text.slice(-2000)}` : text;

/** Follow the tail of a growing log unless the operator scrolled back up. */
const useTailFollow = (dep: unknown) => {
	const ref = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	useEffect(() => {
		const element = ref.current;
		if (element !== null && stick.current)
			element.scrollTop = element.scrollHeight;
	}, [dep]);
	const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		stick.current =
			element.scrollTop + element.clientHeight >= element.scrollHeight - 8;
	};
	return { ref, onScroll };
};

function Section({
	children,
	title,
	tone,
}: {
	readonly children: ReactNode;
	readonly title: string;
	readonly tone?: "attention" | undefined;
}) {
	return (
		<section
			className={cn(
				"space-y-1.5 border-b px-4 py-3",
				tone === "attention" && "bg-warning/8",
			)}
		>
			<h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{title}
			</h3>
			{children}
		</section>
	);
}

function Fact({
	label,
	children,
}: {
	readonly label: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="min-w-0">
			<div className="text-[10px] tracking-wide text-muted-foreground uppercase">
				{label}
			</div>
			<div className="truncate text-xs">{children}</div>
		</div>
	);
}

/**
 * The agent's live voice in a fixed-height frame: the frame never resizes
 * while tokens stream, so nothing below it moves. Message wins over thinking
 * as the newer voice; the tool line lives in vitals and the timeline.
 */
function LiveVoice({
	streams,
}: {
	readonly streams: SerializedAgentAttemptProjection["streams"];
}) {
	// ponytail: hold the last turn's text dimmed so the window does not blink
	// empty at turn_end; bounded to one turn by the reducer's reset.
	const held = useRef({ label: "thinking", text: "" });
	const live =
		streams.message !== undefined && streams.message !== ""
			? { label: "message", text: streams.message }
			: streams.thinking !== undefined && streams.thinking !== ""
				? { label: "thinking", text: streams.thinking }
				: undefined;
	if (live !== undefined) held.current = live;
	const shown = live ?? held.current;
	const follow = useTailFollow(shown.text);
	return (
		<div className="space-y-0.5">
			<div className="text-[10px] tracking-wide text-muted-foreground uppercase">
				{shown.label}
				{live === undefined && shown.text !== "" && " · last turn"}
			</div>
			{/* Top-down prose that follows its own tail; the coss scrollbar
			    stays invisible until the operator scrolls back. */}
			<ScrollAreaPrimitive.Root className="min-h-0">
				<ScrollAreaPrimitive.Viewport
					ref={follow.ref}
					onScroll={follow.onScroll}
					className="h-40 outline-none"
				>
					<p
						className={cn(
							"font-mono text-xs whitespace-pre-wrap text-muted-foreground",
							live === undefined && "opacity-50",
						)}
					>
						{shown.text === ""
							? "waiting for the model…"
							: streamTail(shown.text)}
					</p>
				</ScrollAreaPrimitive.Viewport>
				<ScrollBar orientation="vertical" />
			</ScrollAreaPrimitive.Root>
		</div>
	);
}

function Timeline({ entries }: { readonly entries: readonly TimelineEntry[] }) {
	const follow = useTailFollow(entries.length);
	return (
		<ScrollAreaPrimitive.Root className="min-h-0">
			<ScrollAreaPrimitive.Viewport
				ref={follow.ref}
				onScroll={follow.onScroll}
				className="h-64 outline-none"
			>
				<ol className="space-y-0.5 text-xs">
					{entries.map((entry) => (
						<li
							key={`${entry.atMs}:${entry.text}`}
							className="flex gap-1.5 text-muted-foreground"
						>
							<span className="shrink-0 font-mono">
								{kindGlyph[entry.kind]}
							</span>
							<span className="min-w-0 flex-1 truncate">{entry.text}</span>
							<span className="shrink-0 tabular-nums">
								{formatAgo(entry.atMs)}
							</span>
						</li>
					))}
				</ol>
			</ScrollAreaPrimitive.Viewport>
			<ScrollBar orientation="vertical" />
		</ScrollAreaPrimitive.Root>
	);
}

function AttemptSummaryRow({
	attempt,
}: {
	readonly attempt: SerializedAgentAttemptProjection;
}) {
	const tokens = attempt.tokens?.total ?? attempt.tokens?.output;
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<Badge size="sm" variant={stageVariant[attempt.stage]}>
				{attempt.stage}
			</Badge>
			<span className="min-w-0 flex-1 truncate">{attempt.lastDisplay}</span>
			<span>{attempt.turnCount} turns</span>
			{tokens !== undefined && <span>{formatTokens(tokens)} tok</span>}
			{attempt.lastEventAtMs !== undefined && (
				<span>{formatAgo(attempt.lastEventAtMs)} ago</span>
			)}
		</div>
	);
}

const actionVariant = (
	tone: WorkOperatorAction["tone"],
): "default" | "outline" => (tone === "primary" ? "default" : "outline");

interface SentAction {
	readonly atMs: number;
	readonly label: string;
	/** Work item fingerprint at send time; a change means the Source reconciled. */
	readonly fingerprint: string;
}

const workFingerprint = (work: WorkItemProjection): string =>
	`${work.status}:${work.version ?? ""}:${work.blockedReason ?? ""}`;

/** The reason the web exists: record a human decision, let the Source reconcile. */
function OperatorZone({
	onAction,
	work,
}: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly work: WorkItemProjection;
}) {
	const [pendingId, setPendingId] = useState<string>();
	const [status, setStatus] = useState<string>();
	const [sent, setSent] = useState<SentAction>();
	const actions = workOperatorActions(work);
	// The Source answered (status/version/reason moved): the decision is consumed.
	if (sent !== undefined && workFingerprint(work) !== sent.fingerprint) {
		setSent(undefined);
		setStatus(undefined);
	}
	const act = async (action: WorkOperatorAction) => {
		if (
			action.confirm !== undefined &&
			!window.confirm(
				[action.confirm.title, action.confirm.message]
					.filter((part) => part !== undefined)
					.join("\n"),
			)
		)
			return;
		let comment: string | undefined;
		if (action.requiresComment === true) {
			const value = window.prompt(`${action.label} — comment`);
			if (value === null || value.trim() === "") return;
			comment = value;
		}
		setPendingId(action.id);
		setStatus(undefined);
		try {
			const accepted = await onAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: action.id,
				actionLabel: action.label,
				clientId: crypto.randomUUID(),
				...(comment === undefined ? {} : { comment }),
			});
			if (accepted) {
				setSent({
					atMs: Date.now(),
					label: action.label,
					fingerprint: workFingerprint(work),
				});
			} else {
				setStatus("rejected · session queue is full, try again");
			}
		} catch (caught) {
			setStatus(caught instanceof Error ? caught.message : String(caught));
		} finally {
			setPendingId(undefined);
		}
	};
	const blocked = work.status === "blocked";
	return (
		<Section
			title={blocked ? "Needs you" : "Waiting"}
			tone={blocked ? "attention" : undefined}
		>
			{work.blockedReason !== undefined && (
				<p
					className={
						blocked
							? "text-xs text-warning-foreground"
							: "text-xs text-muted-foreground"
					}
				>
					{work.blockedReason}
				</p>
			)}
			{sent !== undefined ? (
				<p className="text-xs text-muted-foreground">
					✓ {sent.label} recorded {formatAgo(sent.atMs)} ago · waiting for{" "}
					<span className="font-mono">{work.sourceId}</span> to reconcile…
				</p>
			) : (
				actions.length > 0 && (
					<div className="flex flex-wrap gap-1.5">
						{actions.map((action) => (
							<Button
								key={action.id}
								size="sm"
								variant={actionVariant(action.tone)}
								className={
									action.tone === "danger"
										? "border-destructive/40 text-destructive-foreground"
										: undefined
								}
								disabled={
									action.disabledReason !== undefined || pendingId !== undefined
								}
								title={action.disabledReason}
								onClick={() => void act(action)}
							>
								{pendingId === action.id ? "…" : action.label}
							</Button>
						))}
					</div>
				)
			)}
			{status !== undefined && (
				<p className="text-[10px] text-muted-foreground">{status}</p>
			)}
		</Section>
	);
}

export function Inspector({
	onAction,
	onClose,
	projection,
	sessionRunId,
	workKey,
}: {
	readonly onAction: (input: ObservationInput) => Promise<boolean>;
	readonly onClose: () => void;
	readonly projection: WebDashboardProjection;
	readonly sessionRunId: string;
	readonly workKey: string;
}) {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const work = projection.work[workKey];
	const attempts = Object.values(projection.attempts)
		.filter((attempt) => attempt.workKey === workKey)
		.toSorted((left, right) => right.startedAtSeq - left.startedAtSeq);
	const current = attempts[0];
	const history = attempts.slice(1);
	const completed = projection.completed.filter(
		(entry) => entry.workKey === workKey,
	);
	if (work === undefined && current === undefined && completed.length === 0) {
		return null;
	}

	const held = work?.status === "blocked" || work?.status === "waiting";

	const elapsedMs =
		current?.startedAtMs === undefined
			? undefined
			: (current.streaming
					? Date.now()
					: (current.lastEventAtMs ?? Date.now())) - current.startedAtMs;

	return (
		<aside
			aria-label="Work item inspector"
			className="flex w-104 shrink-0 flex-col overflow-hidden border-l bg-background"
		>
			<header className="flex items-start gap-2 border-b px-4 py-3">
				<div className="min-w-0 flex-1 space-y-1">
					<div className="flex items-center gap-2">
						<h2 className="truncate text-sm font-semibold">
							{work?.title ?? completed[0]?.label ?? workKey}
						</h2>
						{work !== undefined && (
							<Badge size="sm" variant="outline" className="shrink-0">
								{work.sourceId}
							</Badge>
						)}
					</div>
					{work?.subtitle !== undefined && (
						<p className="truncate text-xs text-muted-foreground">
							{work.subtitle}
						</p>
					)}
					<div className="flex flex-wrap items-center gap-1.5">
						{(work?.url ?? completed[0]?.url) !== undefined && (
							<a
								className="text-xs text-info-foreground hover:underline"
								href={work?.url ?? completed[0]?.url}
								rel="noreferrer"
								target="_blank"
							>
								open ↗
							</a>
						)}
						{(work?.labels ?? []).map((label) => (
							<Badge key={label} size="sm" variant="secondary">
								{label}
							</Badge>
						))}
						<span className="truncate font-mono text-[10px] text-muted-foreground">
							{workKey}
						</span>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Kbd>Esc</Kbd>
					<Button
						size="sm"
						variant="ghost"
						aria-label="Close"
						onClick={onClose}
					>
						✕
					</Button>
				</div>
			</header>
			<ScrollArea className="min-h-0 flex-1">
				<div>
					{held && work !== undefined && (
						<OperatorZone onAction={onAction} work={work} />
					)}
					{current !== undefined && (
						<Section title="Agent run">
							{/* Fixed six-slot grid: unknown values render "—" so the grid never reflows mid-stream. */}
							<div className="grid grid-cols-3 gap-2 tabular-nums">
								<Fact label="stage">
									<Badge size="sm" variant={stageVariant[current.stage]}>
										{current.stage}
									</Badge>
								</Fact>
								<Fact label="elapsed">
									{elapsedMs === undefined ? "—" : formatDuration(elapsedMs)}
								</Fact>
								<Fact label="turns">{current.turnCount}</Fact>
								<Fact label="tokens">
									{current.tokens?.total === undefined
										? "—"
										: `${formatTokens(current.tokens.total)}${
												current.tokens.cost === undefined
													? ""
													: ` · $${current.tokens.cost.toFixed(2)}`
											}`}
								</Fact>
								<Fact label="check">{current.check}</Fact>
								<Fact label="live">
									{current.streaming ? (
										<span className="inline-flex items-center gap-1">
											<Dot className="animate-pulse bg-success" />
											streaming
										</span>
									) : (
										"idle"
									)}
								</Fact>
							</div>
						</Section>
					)}
					{current !== undefined && (
						<Section title="Now">
							<LiveVoice streams={current.streams} />
						</Section>
					)}
					{current !== undefined && current.timeline.length > 0 && (
						<Section title="Timeline">
							<Timeline entries={current.timeline} />
						</Section>
					)}
					{(history.length > 0 || completed.length > 0) && (
						<Section title="History">
							{completed.map((entry) => (
								<div
									key={`${entry.workKey}:${entry.atMs}`}
									className="flex items-center gap-2 text-xs text-muted-foreground"
								>
									<Badge
										size="sm"
										variant={entry.status === "done" ? "success" : "error"}
									>
										{entry.status}
									</Badge>
									<span className="min-w-0 flex-1 truncate">
										{entry.message}
									</span>
									{entry.durationMs !== undefined && (
										<span>{formatDuration(entry.durationMs)}</span>
									)}
									<span>{formatAgo(entry.atMs)} ago</span>
								</div>
							))}
							{history.map((attempt) => (
								<AttemptSummaryRow attempt={attempt} key={attempt.runId} />
							))}
						</Section>
					)}
					{/* While streaming, the Now pane and timeline already narrate;
					    the transcript is the retrospective record. */}
					{current?.transcript?.path !== undefined && !current.streaming && (
						<Section title="Agent transcript">
							<TranscriptView
								key={current.runId}
								attemptRunId={current.runId}
								path={current.transcript.path}
								runId={sessionRunId}
							/>
						</Section>
					)}
				</div>
			</ScrollArea>
		</aside>
	);
}
