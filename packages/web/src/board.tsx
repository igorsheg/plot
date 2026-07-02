import type { DashboardStatus } from "@plot/session/projection";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { WebDashboardProjection } from "./api.js";
import { Badge, type BadgeProps } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Dot } from "./components/ui/dot.js";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { formatAgo, formatDuration, formatTokens } from "./format.js";
import { Inspector } from "./inspector.js";
import { deriveLanes } from "./lanes.js";
import { cn } from "./lib/utils.js";
import type { PlotRun } from "./run.js";
import {
	ActingCard,
	CompletedCard,
	IncomingCard,
	NeedsYouCard,
	SettledCard,
} from "./work-card.js";

export interface BoardState {
	readonly loading: boolean;
	readonly error?: string | undefined;
	readonly projection?: WebDashboardProjection | undefined;
}

const statusVariant: Record<DashboardStatus, BadgeProps["variant"]> = {
	starting: "info",
	idle: "secondary",
	running: "success",
	shutting_down: "warning",
	paused: "warning",
	stopped: "outline",
	error: "error",
};

const toneDot: Record<string, string> = {
	ok: "bg-success",
	bad: "bg-destructive",
	info: "bg-info",
};

const useHeartbeat = () => {
	const [, setBeat] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setBeat((beat) => beat + 1), 5000);
		return () => clearInterval(interval);
	}, []);
};

const parseWorkKeyHash = (): string | undefined => {
	const match = /^#wi=(.+)$/.exec(window.location.hash);
	return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
};

/** Selection lives in the URL hash: cards are links, back button closes. */
const useSelectedWorkKey = (): string | undefined => {
	const [key, setKey] = useState(parseWorkKeyHash);
	useEffect(() => {
		const onChange = () => setKey(parseWorkKeyHash());
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return key;
};

function Lane({
	children,
	count,
	title,
	tone,
}: {
	readonly children: ReactNode;
	readonly count: number;
	readonly title: string;
	readonly tone?: "attention" | undefined;
}) {
	const hot = tone === "attention" && count > 0;
	return (
		<section
			className={cn(
				"flex min-w-64 flex-1 flex-col rounded-lg border bg-muted/30",
				hot && "border-warning/50 bg-warning/4",
			)}
		>
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{title}
				</h2>
				<Badge size="sm" variant={hot ? "warning" : "secondary"}>
					{count}
				</Badge>
			</header>
			<ScrollArea className="min-h-0 flex-1" scrollFade>
				<div className="space-y-2 p-2">
					{count === 0 ? (
						<p className="px-1 py-2 text-xs text-muted-foreground/60">empty</p>
					) : (
						children
					)}
				</div>
			</ScrollArea>
		</section>
	);
}

function BoardHeader({
	onStop,
	projection,
	run,
}: {
	readonly onStop: () => void;
	readonly projection: WebDashboardProjection | undefined;
	readonly run: PlotRun;
}) {
	const runtime = projection?.runtime;
	const nextWake = projection?.scheduledWakes
		.map((wake) => wake.dueAtMs)
		.toSorted((left, right) => left - right)[0];
	const facts = [
		runtime?.cwdName ?? run.cwdName ?? run.cwd,
		runtime?.model,
		runtime?.provider,
	].filter((fact) => fact !== undefined && fact !== "");
	return (
		<header className="flex items-center gap-3 border-b px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<h1 className="truncate font-semibold">
						{projection?.workflowName ?? run.workflowName ?? run.id}
					</h1>
					{projection !== undefined && (
						<Badge size="sm" variant={statusVariant[projection.status]}>
							{projection.status}
						</Badge>
					)}
				</div>
				<p className="truncate text-xs text-muted-foreground">
					{facts.join(" · ")}
				</p>
			</div>
			<div className="shrink-0 text-right text-xs text-muted-foreground">
				{projection !== undefined && (
					<div>
						{formatTokens(projection.usageTotals.tokens)} tok
						{projection.usageTotals.cost !== undefined &&
							` · $${projection.usageTotals.cost.toFixed(2)}`}
					</div>
				)}
				{nextWake !== undefined && (
					<div>
						{nextWake <= Date.now()
							? "wake due"
							: `next wake in ${formatDuration(nextWake - Date.now())}`}
					</div>
				)}
			</div>
			<Button size="sm" variant="outline" onClick={onStop}>
				Stop
			</Button>
		</header>
	);
}

function ActivityStrip({
	projection,
}: {
	readonly projection: WebDashboardProjection;
}) {
	const latest = projection.activity[0] ?? projection.activity.at(-1);
	if (latest === undefined) return null;
	return (
		<div className="flex items-center gap-2 border-b px-4 py-1.5 text-xs text-muted-foreground">
			<Dot className={toneDot[latest.tone]} />
			<span className="truncate">{latest.text}</span>
			<span className="ml-auto shrink-0">{formatAgo(latest.atMs)} ago</span>
		</div>
	);
}

function NoLiveBoard({
	error,
	run,
}: {
	readonly error: string;
	readonly run: PlotRun;
}) {
	return (
		<div className="grid flex-1 place-items-center">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No live board</EmptyTitle>
					<EmptyDescription>
						{run.status === "online"
							? error
							: `This session is ${run.status}; projections exist only while it runs.`}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</div>
	);
}

function LaneSkeletons() {
	return (
		<div className="flex flex-1 gap-3">
			{[0, 1, 2, 3].map((index) => (
				<Skeleton key={index} className="h-40 flex-1 rounded-lg" />
			))}
		</div>
	);
}

export function SessionBoard({
	onStop,
	run,
	state,
}: {
	readonly onStop: () => void;
	readonly run: PlotRun;
	readonly state: BoardState;
}) {
	useHeartbeat();
	const selectedKey = useSelectedWorkKey();
	const { projection } = state;
	const lanes = projection === undefined ? undefined : deriveLanes(projection);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<BoardHeader onStop={onStop} projection={projection} run={run} />
			{projection !== undefined && <ActivityStrip projection={projection} />}
			{state.error !== undefined && projection === undefined ? (
				<NoLiveBoard error={state.error} run={run} />
			) : (
				<div className="flex min-h-0 flex-1">
					<div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
						{lanes === undefined ? (
							<LaneSkeletons />
						) : (
							<>
								<Lane title="Incoming" count={lanes.incoming.length}>
									{lanes.incoming.map((item) => (
										<IncomingCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane title="Acting" count={lanes.acting.length}>
									{lanes.acting.map((item) => (
										<ActingCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane
									tone="attention"
									title="Needs you"
									count={lanes.needsYou.length}
								>
									{lanes.needsYou.map((item) => (
										<NeedsYouCard
											key={item.work.workKey}
											item={item}
											selected={item.work.workKey === selectedKey}
										/>
									))}
								</Lane>
								<Lane title="Done" count={lanes.done.length}>
									{lanes.done.map((item) =>
										item.kind === "work" ? (
											<SettledCard
												key={item.work.workKey}
												item={item}
												selected={item.work.workKey === selectedKey}
											/>
										) : (
											<CompletedCard
												key={`${item.completed.workKey}:${item.completed.atMs}`}
												item={item}
												selected={item.completed.workKey === selectedKey}
											/>
										),
									)}
								</Lane>
							</>
						)}
					</div>
					{selectedKey !== undefined && projection !== undefined && (
						<Inspector
							onClose={() => {
								window.location.hash = "";
							}}
							projection={projection}
							workKey={selectedKey}
						/>
					)}
				</div>
			)}
		</div>
	);
}
