import type {
	SerializedAgentAttemptProjection,
	TimelineEntry,
} from "@plot/session/projection";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { WebDashboardProjection } from "./api.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Dot } from "./components/ui/dot.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { cn } from "./lib/utils.js";
import { kindGlyph, operatorActionLabels, stageVariant } from "./work-card.js";

/** Display-side tail of a turn-scoped stream; the reducer owns the real window. */
const streamTail = (text: string): string =>
	text.length > 2000 ? `…${text.slice(-2000)}` : text;

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

function LiveStream({
	label,
	text,
}: {
	readonly label: string;
	readonly text: string | undefined;
}) {
	// ponytail: hold the last turn's text dimmed so the window does not blink
	// empty at turn_end; bounded to one turn by the reducer's reset.
	const held = useRef("");
	const live = text !== undefined && text !== "";
	if (live) held.current = text;
	const shown = live ? text : held.current;
	if (shown === "") return null;
	return (
		<div className="space-y-0.5">
			<div className="text-[10px] tracking-wide text-muted-foreground uppercase">
				{label}
			</div>
			<p
				className={cn(
					"max-h-40 overflow-y-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground",
					!live && "opacity-50",
				)}
			>
				{streamTail(shown)}
			</p>
		</div>
	);
}

function Timeline({ entries }: { readonly entries: readonly TimelineEntry[] }) {
	const listRef = useRef<HTMLOListElement>(null);
	const stick = useRef(true);
	useEffect(() => {
		const list = listRef.current;
		if (list !== null && stick.current) list.scrollTop = list.scrollHeight;
	}, [entries.length]);
	return (
		<ol
			ref={listRef}
			onScroll={(event) => {
				const list = event.currentTarget;
				stick.current =
					list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
			}}
			className="max-h-64 space-y-0.5 overflow-y-auto text-xs"
		>
			{entries.map((entry) => (
				<li
					key={`${entry.atMs}:${entry.text}`}
					className="flex gap-1.5 text-muted-foreground"
				>
					<span className="shrink-0 font-mono">{kindGlyph[entry.kind]}</span>
					<span className="min-w-0 flex-1 truncate">{entry.text}</span>
					<span className="shrink-0">{formatAgo(entry.atMs)}</span>
				</li>
			))}
		</ol>
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

export function Inspector({
	onClose,
	projection,
	workKey,
}: {
	readonly onClose: () => void;
	readonly projection: WebDashboardProjection;
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

	const blocked = work?.status === "blocked";
	const actions = work === undefined ? [] : operatorActionLabels(work);
	const elapsedMs =
		current?.startedAtMs === undefined
			? undefined
			: (current.streaming
					? Date.now()
					: (current.lastEventAtMs ?? Date.now())) - current.startedAtMs;
	const activeTargets = (current?.activeTools ?? [])
		.map(([, tool]) => tool.target)
		.filter((target) => target !== undefined);

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
				<Button size="sm" variant="ghost" aria-label="Close" onClick={onClose}>
					✕
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{blocked && (
					<Section title="Needs you" tone="attention">
						{work?.blockedReason !== undefined && (
							<p className="text-xs text-warning-foreground">
								{work.blockedReason}
							</p>
						)}
						{actions.length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{actions.map((label) => (
									<Button
										key={label}
										size="sm"
										variant="outline"
										disabled
										title="Take this action from plot tui"
									>
										{label}
									</Button>
								))}
							</div>
						)}
					</Section>
				)}
				{current !== undefined && (
					<Section title="Agent run">
						<div className="grid grid-cols-3 gap-2">
							<Fact label="stage">
								<Badge size="sm" variant={stageVariant[current.stage]}>
									{current.stage}
								</Badge>
							</Fact>
							{elapsedMs !== undefined && (
								<Fact label="elapsed">{formatDuration(elapsedMs)}</Fact>
							)}
							<Fact label="turns">{current.turnCount}</Fact>
							{current.tokens?.total !== undefined && (
								<Fact label="tokens">
									{formatTokens(current.tokens.total)}
									{current.tokens.cost !== undefined &&
										` · $${current.tokens.cost.toFixed(2)}`}
								</Fact>
							)}
							<Fact label="check">{current.check}</Fact>
							{current.streaming && (
								<Fact label="live">
									<span className="inline-flex items-center gap-1">
										<Dot className="animate-pulse bg-success" />
										streaming
									</span>
								</Fact>
							)}
						</div>
						{activeTargets.length > 0 && (
							<p className="truncate font-mono text-xs text-muted-foreground">
								{activeTargets.join(" · ")}
							</p>
						)}
					</Section>
				)}
				{current !== undefined && (
					<Section title="Now">
						<LiveStream label="thinking" text={current.streams.thinking} />
						<LiveStream label="message" text={current.streams.message} />
						<LiveStream label="tool" text={current.streams.tool} />
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
								<span className="min-w-0 flex-1 truncate">{entry.message}</span>
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
				{current?.transcript?.path !== undefined && (
					<Section title="Agent transcript">
						<div className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
								{current.transcript.path}
							</span>
							<Button
								size="sm"
								variant="outline"
								onClick={() =>
									void navigator.clipboard.writeText(
										current.transcript?.path ?? "",
									)
								}
							>
								Copy
							</Button>
						</div>
					</Section>
				)}
			</div>
		</aside>
	);
}
