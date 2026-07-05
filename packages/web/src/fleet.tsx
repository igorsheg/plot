import type { ReactNode } from "react";
import { Badge } from "./components/ui/badge.js";
import { Dot } from "./components/ui/dot.js";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import type { WebDashboardProjection } from "./api.js";
import { deriveBrief } from "./derive-brief.js";
import type { FleetStream } from "./derive-fleet.js";
import { cn } from "./lib/utils.js";
import { ThemeToggle } from "./theme.js";
import { formatClockDuration, useNow } from "./use-countdown.js";
import { viewTransitionName } from "./work-card.js";

const anchorKey = (sessionId: string): string => `plot:lastSeen:${sessionId}`;

const readAnchor = (sessionId: string | undefined): number | undefined => {
	if (sessionId === undefined) return undefined;
	try {
		const value = Number(localStorage.getItem(anchorKey(sessionId)));
		return Number.isFinite(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
};

const streamProjection = (
	stream: FleetStream,
	projections: ReadonlyMap<string, WebDashboardProjection>,
): WebDashboardProjection | undefined =>
	stream.runs.flatMap((run) => {
		const projection = projections.get(run.id);
		return projection === undefined ? [] : [projection];
	})[0];

const dotClass = (stream: FleetStream): string | undefined => {
	switch (stream.state) {
		case "acting":
			return "animate-pulse bg-success";
		case "watching":
			return "bg-success opacity-60";
		case "crashed":
			return "bg-destructive";
		case "paused":
		case "ended":
			return "bg-muted-foreground/40";
	}
};

const formatFleetAgo = (atMs: number, nowMs: number): string => {
	const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${Math.round(seconds / 3600)}h`;
};

const workflowCopy = (count: number): string =>
	count === 1 ? "workflow" : "workflows";

const streamDetail = (stream: FleetStream): string =>
	stream.cwdName === stream.name
		? stream.verb
		: `${stream.verb} · ${stream.cwdName}`;

const needsCopy = (count: number): string =>
	count === 1 ? "1 needs you" : `${count} need you`;

function CountSegment({ children }: { readonly children: ReactNode }) {
	return (
		<span className="font-semibold text-warning-foreground">{children}</span>
	);
}

const joinSegments = (parts: readonly ReactNode[]): ReactNode =>
	parts.map((part, index) => (
		<span key={index}>
			{index > 0 && ", "}
			{part}
		</span>
	));

export function FleetRail({
	onHome,
	onOpenPalette,
	onSelect,
	selectedKey,
	streams,
}: {
	readonly onHome: () => void;
	readonly onOpenPalette: () => void;
	readonly onSelect: (key: string) => void;
	readonly selectedKey: string | undefined;
	readonly streams: readonly FleetStream[];
}) {
	return (
		<aside className="flex w-64 shrink-0 flex-col border-r bg-sidebar">
			<div className="flex items-center border-b px-4 py-2.5">
				<button
					type="button"
					onClick={onHome}
					className="rounded px-1.5 py-0.5 font-semibold hover:bg-sidebar-accent/60"
				>
					Plot
				</button>
				<div className="ml-auto">
					<ThemeToggle />
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1" scrollFade>
				<nav className="space-y-1 p-2">
					{streams.map((stream) => (
						<button
							key={stream.key}
							type="button"
							onClick={() => onSelect(stream.key)}
							className={cn(
								"w-full rounded-md px-3 py-2 text-left hover:bg-sidebar-accent/60",
								stream.key === selectedKey && "bg-sidebar-accent",
							)}
							style={{ viewTransitionName: viewTransitionName(stream.key) }}
						>
							<div className="flex items-center gap-2">
								<Dot className={cn("size-2", dotClass(stream))} />
								<span className="min-w-0 flex-1 truncate text-sm font-medium text-sidebar-accent-foreground">
									{stream.name}
								</span>
								{stream.needsYou > 0 && (
									<Badge size="sm" variant="warning">
										{stream.needsYou}
									</Badge>
								)}
							</div>
							<div className="truncate pl-4 text-xs text-muted-foreground">
								{streamDetail(stream)}
							</div>
						</button>
					))}
				</nav>
			</ScrollArea>
			<div className="border-t px-4 py-3">
				<button
					type="button"
					className="text-xs text-muted-foreground hover:text-foreground"
					onClick={onOpenPalette}
				>
					⌘K
				</button>
			</div>
		</aside>
	);
}

function ZeroState() {
	return (
		<div className="grid flex-1 place-items-center">
			<Empty className="max-w-md rounded-lg border p-6">
				<pre className="rounded-md bg-muted p-3 font-mono text-xs">
					plot --workflow WORKFLOW.md
				</pre>
				<EmptyHeader>
					<EmptyTitle>Nothing is delegated yet.</EmptyTitle>
					<EmptyDescription>
						Start a workflow and it appears here live.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}

export function FleetBriefHome({
	onSelect,
	projections,
	streams,
}: {
	readonly onSelect: (key: string) => void;
	readonly projections: ReadonlyMap<string, WebDashboardProjection>;
	readonly streams: readonly FleetStream[];
}) {
	const nowMs = useNow();
	if (streams.length === 0) return <ZeroState />;
	let handled = 0;
	let failed = 0;
	let needsYou = 0;
	let running = 0;
	let nextWake: number | undefined;
	let hasAnchor = false;
	for (const stream of streams) {
		needsYou += stream.needsYou;
		running += stream.acting;
		if (stream.runs.some((run) => readAnchor(run.sessionId) !== undefined))
			hasAnchor = true;
		const projection = streamProjection(stream, projections);
		if (projection === undefined) continue;
		const anchorMs = readAnchor(projection.sessionId);
		if (anchorMs !== undefined) hasAnchor = true;
		const model = deriveBrief(projection, anchorMs, nowMs);
		handled += model.counts.handled;
		failed += model.counts.failed;
		for (const wake of projection.scheduledWakes) {
			if (nextWake === undefined || wake.dueAtMs < nextWake)
				nextWake = wake.dueAtMs;
		}
	}
	const hasLiveStream = streams.some(
		(stream) => stream.state === "acting" || stream.state === "watching",
	);
	const wakeText =
		nextWake === undefined
			? undefined
			: nextWake <= nowMs
				? "next wake due"
				: `next wake in ${formatClockDuration(nextWake - nowMs)}`;
	const secondLine =
		hasLiveStream && (running > 0 || wakeText !== undefined)
			? [running > 0 ? `${running} running now` : undefined, wakeText]
					.filter((part) => part !== undefined)
					.join(" · ")
			: undefined;
	const firstLine = () => {
		if (!hasLiveStream) return "Nothing is running.";
		if (handled === 0 && failed === 0 && needsYou === 0)
			return "All quiet across the fleet.";
		const parts: ReactNode[] = [];
		if (handled > 0) parts.push(`${handled} handled`);
		if (failed > 0) parts.push(`${failed} failed`);
		if (needsYou > 0)
			parts.push(
				<CountSegment key="needs">{needsCopy(needsYou)}</CountSegment>,
			);
		return (
			<>
				{joinSegments(parts)} across {streams.length}{" "}
				{workflowCopy(streams.length)} {hasAnchor ? "since you left" : "so far"}
				.
			</>
		);
	};
	return (
		<div className="grid flex-1 place-items-center px-6">
			<div className="w-full max-w-2xl space-y-6">
				<div className="space-y-1">
					<p className="text-lg font-medium">{firstLine()}</p>
					{secondLine !== undefined && (
						<p className="text-sm text-muted-foreground">{secondLine}</p>
					)}
				</div>
				<div className="divide-y divide-border/60">
					{streams.map((stream) => {
						const rowVerb = stream.state === "ended" ? "ended" : stream.verb;
						return (
							<button
								key={stream.key}
								type="button"
								onClick={() => onSelect(stream.key)}
								className="flex w-full items-center gap-2 py-2 text-left hover:bg-sidebar-accent/60"
							>
								<Dot className={cn("size-2", dotClass(stream))} />
								<span className="min-w-0 flex-1 truncate text-sm font-medium">
									{stream.name}
								</span>
								<span className="max-w-36 truncate text-xs text-muted-foreground">
									{rowVerb}
								</span>
								{stream.needsYou > 0 && (
									<Badge size="sm" variant="warning">
										{stream.needsYou}
									</Badge>
								)}
								<span className="w-12 shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground">
									{formatFleetAgo(stream.lastSeenMs, nowMs)} ago
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</div>
	);
}
