import { createContext, use, useMemo } from "react";
import type { ReactNode } from "react";
import { Badge, type BadgeProps } from "./components/ui/badge.js";
import { Dot } from "./components/ui/dot.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { deriveBrief, type BriefModel } from "./derive-brief.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { cn } from "./lib/utils.js";
import { OperatorZoneBody } from "./operator-zone.js";
import { useSession } from "./session-context.js";
import { useHeartbeat } from "./use-heartbeat.js";
import { kindGlyph, workItemHref, workOperatorActions } from "./work-card.js";

interface BriefContextValue {
	readonly state: {
		readonly anchorMs: number | undefined;
		readonly live: boolean;
		readonly model: BriefModel | undefined;
		readonly nowMs: number;
	};
}

const BriefContext = createContext<BriefContextValue | null>(null);

const useBrief = (): BriefContextValue => {
	const value = use(BriefContext);
	if (value === null) throw new Error("Brief part outside BriefProvider");
	return value;
};

const isRunLive = (status: string): boolean =>
	status === "online" || status === "running";

function BriefProvider({
	anchorMs,
	children,
}: {
	readonly anchorMs: number | undefined;
	readonly children: ReactNode;
}) {
	useHeartbeat();
	const { state } = useSession();
	const nowMs = Date.now();
	const model = useMemo(
		() =>
			state.projection === undefined
				? undefined
				: deriveBrief(state.projection, anchorMs, nowMs),
		[state.projection, anchorMs, nowMs],
	);
	return (
		<BriefContext
			value={{
				state: { anchorMs, live: isRunLive(state.run.status), model, nowMs },
			}}
		>
			{children}
		</BriefContext>
	);
}

function Frame({ children }: { readonly children: ReactNode }) {
	return (
		<ScrollArea className="min-h-0 flex-1" fill>
			<div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8">
				{children}
			</div>
		</ScrollArea>
	);
}

function CountSegment({
	children,
	hot,
}: {
	readonly children: ReactNode;
	readonly hot?: boolean | undefined;
}) {
	return (
		<span
			className={cn(hot === true && "font-semibold text-warning-foreground")}
		>
			{children}
		</span>
	);
}

const needsCopy = (count: number): string =>
	count === 1 ? "1 needs you" : `${count} need you`;

const itemsNeedCopy = (count: number): string =>
	count === 1 ? "1 item needs you." : `${count} items need you.`;

function Headline() {
	const {
		state: { anchorMs, live, model, nowMs },
	} = useBrief();
	if (model === undefined) return null;
	const { counts, totals } = model;
	const settled = counts.handled + counts.failed;
	const completedTotal = model.outcomes.length;
	const firstLine = () => {
		if (!live) {
			const parts: ReactNode[] = [];
			if (totals.handled > 0) parts.push(`${totals.handled} handled`);
			if (totals.failed > 0) parts.push(`${totals.failed} failed`);
			return parts.length === 0 ? (
				"This session has ended."
			) : (
				<>This session has ended — {joinSegments(parts)}.</>
			);
		}
		if (anchorMs === undefined) {
			if (completedTotal === 0 && counts.needsYou === 0)
				return "Watching for work.";
			if (completedTotal === 0 && counts.needsYou > 0)
				return (
					<CountSegment hot>{itemsNeedCopy(counts.needsYou)}</CountSegment>
				);
			const parts: ReactNode[] = [];
			if (counts.handled > 0) parts.push(`${counts.handled} handled`);
			if (counts.failed > 0) parts.push(`${counts.failed} failed`);
			return <>So far — {joinSegments(parts)}.</>;
		}
		if (settled === 0 && counts.needsYou === 0)
			return "All quiet since you last looked.";
		if (settled === 0 && counts.needsYou > 0)
			return <CountSegment hot>{itemsNeedCopy(counts.needsYou)}</CountSegment>;
		const parts: ReactNode[] = [];
		if (counts.handled > 0) parts.push(`${counts.handled} handled`);
		if (counts.failed > 0) parts.push(`${counts.failed} failed`);
		if (counts.needsYou > 0)
			parts.push(
				<CountSegment key="needs" hot>
					{needsCopy(counts.needsYou)}
				</CountSegment>,
			);
		return <>Since you last looked — {joinSegments(parts)}.</>;
	};
	const nextWake = model.comingUp.find(
		(entry) => entry.kind === "wake" && entry.wake.dueAtMs > nowMs,
	);
	const rhythm =
		counts.acting > 0
			? `${counts.acting} running now`
			: nextWake?.kind === "wake"
				? `next wake in ${formatDuration(nextWake.wake.dueAtMs - nowMs)}${
						nextWake.wake.reason === undefined
							? ""
							: ` — ${nextWake.wake.reason}`
					}`
				: "idle";
	const secondLine = !live
		? anchorMs === undefined
			? undefined
			: `checked ${formatAgo(anchorMs)} ago`
		: anchorMs === undefined
			? rhythm
			: `checked ${formatAgo(anchorMs)} ago · ${rhythm}`;
	return (
		<div className="space-y-1">
			<p className="text-lg font-medium">{firstLine()}</p>
			{secondLine !== undefined && (
				<p className="truncate text-sm text-muted-foreground">{secondLine}</p>
			)}
		</div>
	);
}

const joinSegments = (parts: readonly ReactNode[]): ReactNode =>
	parts.map((part, index) => (
		<span key={index}>
			{index > 0 && ", "}
			{part}
		</span>
	));

function SectionHeader({
	count,
	title,
	variant = "secondary",
}: {
	readonly count: number;
	readonly title: string;
	readonly variant?: BadgeProps["variant"] | undefined;
}) {
	return (
		<header className="flex items-center gap-2">
			<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{title}
			</h2>
			<Badge size="sm" variant={variant}>
				{count}
			</Badge>
		</header>
	);
}

function NeedsYou() {
	const {
		state: { model },
	} = useBrief();
	const { actions } = useSession();
	if (model === undefined || model.counts.needsYou === 0) return null;
	return (
		<section className="space-y-2">
			<SectionHeader
				title="Needs you"
				count={model.counts.needsYou}
				variant="warning"
			/>
			<div className="space-y-2">
				{model.needsYou.map((work) => (
					<div
						key={work.workKey}
						className="space-y-1.5 rounded-md border border-warning/40 bg-warning/4 p-3"
					>
						<div className="flex items-start justify-between gap-2">
							<a
								href={workItemHref(work.workKey)}
								className="min-w-0 truncate text-sm font-medium hover:underline"
							>
								{work.title}
							</a>
							<Badge size="sm" variant="outline" className="shrink-0">
								{work.sourceId}
							</Badge>
						</div>
						<OperatorZoneBody onAction={actions.act} work={work} />
					</div>
				))}
			</div>
		</section>
	);
}

function Acting() {
	const {
		state: { model },
	} = useBrief();
	if (model === undefined || model.acting.length === 0) return null;
	return (
		<section className="space-y-2">
			<SectionHeader title="Running" count={model.counts.acting} />
			<div className="divide-y divide-border/60">
				{model.acting.map(({ attempt, work }) => {
					const tokens = attempt?.tokens?.total ?? attempt?.tokens?.output;
					return (
						<div key={work.workKey} className="flex items-center gap-2 py-1.5">
							<Dot
								className={cn(
									attempt?.streaming === true
										? "animate-pulse bg-success"
										: "bg-info",
								)}
							/>
							<a
								href={workItemHref(work.workKey)}
								className="min-w-0 truncate text-sm hover:underline"
							>
								{work.title}
							</a>
							{attempt !== undefined && (
								<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
									{kindGlyph[attempt.activityKind]} {attempt.activity}
								</span>
							)}
							{attempt !== undefined && (
								<span className="shrink-0 text-xs text-muted-foreground">
									{attempt.turnCount} turns
									{tokens !== undefined && ` · ${formatTokens(tokens)} tok`}
								</span>
							)}
						</div>
					);
				})}
			</div>
		</section>
	);
}

function ComingUp() {
	const {
		state: { live, model, nowMs },
	} = useBrief();
	const { actions } = useSession();
	if (model === undefined || !live || model.comingUp.length === 0) return null;
	const shown = model.comingUp.slice(0, 6);
	const overflow = model.comingUp.length - shown.length;
	return (
		<section className="space-y-2">
			<SectionHeader title="Coming up" count={model.comingUp.length} />
			<div className="space-y-1.5">
				{shown.map((entry, index) =>
					entry.kind === "wake" ? (
						<div
							key={`wake:${index}:${entry.wake.dueAtMs}`}
							className="flex gap-3"
						>
							<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
								{entry.wake.dueAtMs <= nowMs
									? "due"
									: `in ${formatDuration(entry.wake.dueAtMs - nowMs)}`}
							</span>
							<div className="min-w-0 flex-1 text-sm">
								<span>{entry.wake.reason ?? "tick"}</span>
								{(entry.wake.attempt ?? 1) > 1 && (
									<Badge size="sm" variant="warning" className="ml-1">
										retry #{entry.wake.attempt}
									</Badge>
								)}
								{entry.workTitle !== undefined && (
									<span className="truncate text-muted-foreground">
										{" "}
										· {entry.workTitle}
									</span>
								)}
							</div>
						</div>
					) : (
						<div key={`waiting:${entry.work.workKey}`} className="space-y-1">
							<div className="flex gap-3">
								<span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
									held
								</span>
								<div className="min-w-0 flex-1">
									<a
										href={workItemHref(entry.work.workKey)}
										className="text-sm hover:underline"
									>
										{entry.work.title}
									</a>
									{entry.work.blockedReason !== undefined && (
										<p className="truncate text-xs text-muted-foreground">
											{entry.work.blockedReason}
										</p>
									)}
								</div>
							</div>
							{workOperatorActions(entry.work).length > 0 && (
								<div className="ml-19 space-y-1.5">
									<OperatorZoneBody onAction={actions.act} work={entry.work} />
								</div>
							)}
						</div>
					),
				)}
				{overflow > 0 && (
					<p className="text-xs text-muted-foreground">+ {overflow} more</p>
				)}
			</div>
		</section>
	);
}

function Outcomes() {
	const {
		state: { model },
	} = useBrief();
	if (model === undefined) return null;
	const shown = model.outcomes.slice(0, 20);
	const overflow = model.outcomes.length - shown.length;
	return (
		<section className="space-y-2">
			<SectionHeader title="Outcomes" count={model.outcomes.length} />
			{model.outcomes.length === 0 ? (
				<p className="text-xs text-muted-foreground">Nothing settled yet.</p>
			) : (
				<div className="divide-y divide-border/60">
					{shown.map(({ completed, isNew }) => {
						const meta = [
							`${formatAgo(completed.atMs)} ago`,
							completed.durationMs === undefined
								? undefined
								: formatDuration(completed.durationMs),
							completed.tokens?.total === undefined
								? undefined
								: `${formatTokens(completed.tokens.total)} tok`,
						].filter((value) => value !== undefined);
						return (
							<div
								key={`${completed.workKey}:${completed.atMs}`}
								className="flex gap-2 py-1.5"
							>
								<Dot
									className={cn(
										"mt-1.5 shrink-0 self-start",
										completed.status === "done"
											? "bg-success"
											: "bg-destructive",
									)}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex min-w-0 items-center gap-1.5">
										<a
											href={workItemHref(completed.workKey)}
											className="truncate text-sm hover:underline"
										>
											{completed.label}
										</a>
										{isNew && (
											<Badge size="sm" variant="info">
												new
											</Badge>
										)}
									</div>
									{completed.message !== "" && (
										<p className="line-clamp-1 text-xs text-muted-foreground">
											{completed.message}
										</p>
									)}
								</div>
								<span className="shrink-0 text-xs text-muted-foreground">
									{meta.join(" · ")}
								</span>
							</div>
						);
					})}
					{overflow > 0 && (
						<p className="py-1.5 text-xs text-muted-foreground">
							+ {overflow} earlier
						</p>
					)}
				</div>
			)}
		</section>
	);
}

const Brief = {
	Frame,
	Headline,
	NeedsYou,
	Acting,
	ComingUp,
	Outcomes,
};

export function SessionBrief({
	anchorMs,
}: {
	readonly anchorMs: number | undefined;
}) {
	return (
		<BriefProvider anchorMs={anchorMs}>
			<Brief.Frame>
				<Brief.Headline />
				<Brief.NeedsYou />
				<Brief.Acting />
				<Brief.ComingUp />
				<Brief.Outcomes />
			</Brief.Frame>
		</BriefProvider>
	);
}
