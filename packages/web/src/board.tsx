import { isRecord } from "@plot/common/primitives";
import type {
	ActivityKind,
	DashboardStatus,
	AttemptStage,
} from "@plot/session/projection";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { WebDashboardProjection } from "./api.js";
import { Badge, type BadgeProps } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Skeleton } from "./components/ui/skeleton.js";
import {
	deriveLanes,
	type CompletedLaneItem,
	type WorkLaneItem,
} from "./lanes.js";
import { cn } from "./lib/utils.js";
import type { PlotRun } from "./run.js";

export interface BoardState {
	readonly loading: boolean;
	readonly error?: string | undefined;
	readonly projection?: WebDashboardProjection | undefined;
}

const kindGlyph: Record<ActivityKind, string> = {
	think: "✻",
	read: "⌗",
	edit: "✎",
	search: "⌕",
	run: "❯",
	test: "✓",
	finish: "⚑",
	message: "✉",
	wait: "◷",
};

const statusVariant: Record<DashboardStatus, BadgeProps["variant"]> = {
	starting: "info",
	idle: "secondary",
	running: "success",
	shutting_down: "warning",
	paused: "warning",
	stopped: "outline",
	error: "error",
};

const stageVariant: Record<AttemptStage, BadgeProps["variant"]> = {
	starting: "secondary",
	working: "info",
	verifying: "warning",
	finishing: "success",
	failed: "error",
};

const toneDot: Record<string, string> = {
	ok: "bg-success",
	bad: "bg-destructive",
	info: "bg-info",
};

const formatTokens = (value: number): string =>
	value >= 1_000_000
		? `${(value / 1_000_000).toFixed(1)}M`
		: value >= 1_000
			? `${(value / 1_000).toFixed(1)}k`
			: `${value}`;

const formatAgo = (atMs: number): string => {
	const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	return `${Math.round(seconds / 3600)}h`;
};

const formatDuration = (ms: number): string => {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
};

const operatorActionLabel = (value: unknown): string | undefined => {
	if (typeof value === "string") return value;
	if (!isRecord(value)) return undefined;
	const label =
		value["label"] ?? value["title"] ?? value["name"] ?? value["id"];
	return typeof label === "string" ? label : undefined;
};

/** Stable CSS custom-ident for per-card view transitions. */
const viewTransitionName = (key: string): string => {
	let hash = 5381;
	for (const char of key) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
	return `wi-${hash.toString(36)}`;
};

const useHeartbeat = () => {
	const [, setBeat] = useState(0);
	useEffect(() => {
		const interval = setInterval(() => setBeat((beat) => beat + 1), 5000);
		return () => clearInterval(interval);
	}, []);
};

function MetaRow({ children }: { readonly children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
			{children}
		</div>
	);
}

function WorkCard({ item }: { readonly item: WorkLaneItem }) {
	const { work, attempt } = item;
	const tokens = attempt?.tokens?.total ?? attempt?.tokens?.output;
	const actions = (work.operatorActions ?? [])
		.map(operatorActionLabel)
		.filter((label) => label !== undefined);
	const blocked = work.status === "blocked";
	return (
		<details
			className={cn(
				"group rounded-md border bg-card p-2.5 shadow-xs open:shadow-sm",
				blocked && "border-warning/40 bg-warning/4",
			)}
			style={{ viewTransitionName: viewTransitionName(work.workKey) }}
		>
			<summary className="cursor-pointer select-none space-y-1.5 outline-none">
				<div className="flex items-start justify-between gap-2">
					<span className="min-w-0 truncate text-sm font-medium">
						{work.title}
					</span>
					<Badge size="sm" variant="outline" className="shrink-0">
						{work.sourceId}
					</Badge>
				</div>
				{work.subtitle !== undefined && (
					<p className="truncate text-xs text-muted-foreground">
						{work.subtitle}
					</p>
				)}
				{attempt !== undefined && (
					<div className="flex items-center gap-1.5 text-xs">
						<Badge size="sm" variant={stageVariant[attempt.stage]}>
							{attempt.stage}
						</Badge>
						{attempt.streaming && (
							<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" />
						)}
						<span className="truncate font-mono text-muted-foreground">
							{kindGlyph[attempt.activityKind]} {attempt.activity}
						</span>
					</div>
				)}
				{blocked && work.blockedReason !== undefined && (
					<p className="text-xs text-warning-foreground">
						{work.blockedReason}
					</p>
				)}
				{actions.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{actions.map((label) => (
							<Badge
								key={label}
								size="sm"
								variant="warning"
								title="Take this action from plot tui"
							>
								{label}
							</Badge>
						))}
					</div>
				)}
				<MetaRow>
					{attempt !== undefined && (
						<>
							<span className="font-mono">
								{attempt.phases.map((phase) => kindGlyph[phase.kind]).join(" ")}
							</span>
							<span>{attempt.turnCount} turns</span>
							{tokens !== undefined && <span>{formatTokens(tokens)} tok</span>}
							{attempt.check === "running" && (
								<Badge size="sm" variant="info">
									checking
								</Badge>
							)}
							{attempt.check === "passed" && (
								<Badge size="sm" variant="success">
									checks ✓
								</Badge>
							)}
							{attempt.check === "failed" && (
								<Badge size="sm" variant="error">
									checks ✗
								</Badge>
							)}
						</>
					)}
					{work.labels.map((label) => (
						<Badge key={label} size="sm" variant="secondary">
							{label}
						</Badge>
					))}
				</MetaRow>
			</summary>
			{attempt !== undefined && (
				<div className="mt-2 space-y-2 border-t pt-2 text-xs">
					{attempt.timeline.length > 0 && (
						<ol className="space-y-0.5">
							{attempt.timeline.slice(-10).map((entry) => (
								<li
									key={`${entry.atMs}:${entry.text}`}
									className="flex gap-1.5 text-muted-foreground"
								>
									<span className="shrink-0 font-mono">
										{kindGlyph[entry.kind]}
									</span>
									<span className="min-w-0 flex-1 truncate">{entry.text}</span>
									<span className="shrink-0">{formatAgo(entry.atMs)}</span>
								</li>
							))}
						</ol>
					)}
					{(["thinking", "message", "tool"] as const).map((stream) => {
						const text = attempt.streams[stream];
						return text === undefined || text === "" ? null : (
							<p
								key={stream}
								className="line-clamp-3 font-mono text-muted-foreground"
							>
								{text}
							</p>
						);
					})}
					{attempt.observations.length > 0 && (
						<MetaRow>
							{attempt.observations.map((observation) => (
								<Badge key={observation} size="sm" variant="outline">
									{observation}
								</Badge>
							))}
						</MetaRow>
					)}
					{attempt.transcript?.path !== undefined && (
						<p className="truncate font-mono text-muted-foreground">
							{attempt.transcript.path}
						</p>
					)}
				</div>
			)}
		</details>
	);
}

function CompletedCard({ item }: { readonly item: CompletedLaneItem }) {
	const { completed } = item;
	const failed = completed.status !== "done";
	return (
		<div
			className="space-y-1.5 rounded-md border bg-card p-2.5 opacity-80 shadow-xs"
			style={{ viewTransitionName: viewTransitionName(completed.workKey) }}
		>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 truncate text-sm font-medium">
					{completed.label}
				</span>
				<Badge size="sm" variant={failed ? "error" : "success"}>
					{completed.status}
				</Badge>
			</div>
			{completed.message !== "" && (
				<p className="line-clamp-2 text-xs text-muted-foreground">
					{completed.message}
				</p>
			)}
			<MetaRow>
				<span>{formatAgo(completed.atMs)} ago</span>
				{completed.durationMs !== undefined && (
					<span>{formatDuration(completed.durationMs)}</span>
				)}
				{completed.tokens?.total !== undefined && (
					<span>{formatTokens(completed.tokens.total)} tok</span>
				)}
			</MetaRow>
		</div>
	);
}

function Lane({
	accent,
	count,
	items,
	title,
}: {
	readonly accent?: boolean | undefined;
	readonly count: number;
	readonly items: ReactNode;
	readonly title: string;
}) {
	return (
		<section
			className={cn(
				"flex min-w-64 flex-1 flex-col rounded-lg border bg-muted/30",
				accent === true && count > 0 && "border-warning/50 bg-warning/4",
			)}
		>
			<header className="flex items-center gap-2 border-b px-3 py-2">
				<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					{title}
				</h2>
				<Badge
					size="sm"
					variant={accent === true && count > 0 ? "warning" : "secondary"}
				>
					{count}
				</Badge>
			</header>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
				{count === 0 ? (
					<p className="px-1 py-2 text-xs text-muted-foreground/60">empty</p>
				) : (
					items
				)}
			</div>
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
			<span
				className={cn(
					"size-1.5 shrink-0 rounded-full",
					toneDot[latest.tone] ?? "bg-info",
				)}
			/>
			<span className="truncate">{latest.text}</span>
			<span className="ml-auto shrink-0">{formatAgo(latest.atMs)} ago</span>
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
	const { projection } = state;
	const lanes = projection === undefined ? undefined : deriveLanes(projection);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<BoardHeader onStop={onStop} projection={projection} run={run} />
			{projection !== undefined && <ActivityStrip projection={projection} />}
			{state.error !== undefined && (
				<p className="border-b px-4 py-2 text-xs text-destructive-foreground">
					{state.error}
				</p>
			)}
			<div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
				{lanes === undefined ? (
					<div className="flex flex-1 gap-3">
						{[0, 1, 2, 3].map((index) => (
							<Skeleton key={index} className="h-40 flex-1 rounded-lg" />
						))}
					</div>
				) : (
					<>
						<Lane
							title="Incoming"
							count={lanes.incoming.length}
							items={lanes.incoming.map((item) => (
								<WorkCard key={item.work.workKey} item={item} />
							))}
						/>
						<Lane
							title="Acting"
							count={lanes.acting.length}
							items={lanes.acting.map((item) => (
								<WorkCard key={item.work.workKey} item={item} />
							))}
						/>
						<Lane
							accent
							title="Needs you"
							count={lanes.needsYou.length}
							items={lanes.needsYou.map((item) => (
								<WorkCard key={item.work.workKey} item={item} />
							))}
						/>
						<Lane
							title="Done"
							count={lanes.done.length}
							items={lanes.done.map((item) =>
								item.kind === "work" ? (
									<WorkCard key={item.work.workKey} item={item} />
								) : (
									<CompletedCard
										key={`${item.completed.workKey}:${item.completed.atMs}`}
										item={item}
									/>
								),
							)}
						/>
					</>
				)}
			</div>
		</div>
	);
}
