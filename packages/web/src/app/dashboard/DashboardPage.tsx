import {
	Activity,
	AlertTriangle,
	ArrowUpRight,
	Bot,
	CheckCircle2,
	CircleDot,
	Clock3,
	GitBranch,
	PauseCircle,
	Radio,
	ShieldAlert,
	Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
	PlotDashboardState,
	SourceSummary,
	TimelineKind,
	WorkItemSummary,
	WorkStatus,
	WorkTimelineEvent,
} from "./dashboard-state";
import { mockDashboardState } from "./mock-dashboard-state";

const statusOrder: WorkStatus[] = [
	"running",
	"blocked",
	"ready",
	"backoff",
	"completed",
];

const statusLabels: Record<WorkStatus, string> = {
	running: "Running",
	blocked: "Blocked",
	ready: "Ready",
	backoff: "Backoff",
	completed: "Completed",
};

const statusStyles: Record<WorkStatus, string> = {
	running: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
	blocked:
		"border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
	ready:
		"border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	backoff:
		"border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
	completed:
		"border-neutral-500/20 bg-neutral-500/10 text-muted-foreground dark:text-neutral-300",
};

const timelineIcons: Record<TimelineKind, typeof CircleDot> = {
	tick: Radio,
	observation: GitBranch,
	decision: ShieldAlert,
	run: Bot,
	diagnostic: AlertTriangle,
};

interface DashboardPageProps {
	state?: PlotDashboardState;
}

export function DashboardPage({
	state = mockDashboardState,
}: DashboardPageProps) {
	const [selectedWorkId, setSelectedWorkId] = useState(state.selectedWorkId);
	const selectedWork =
		state.work.find((work) => work.id === selectedWorkId) ?? state.work[0];
	const counts = useMemo(
		() =>
			Object.fromEntries(
				statusOrder.map((status) => [
					status,
					state.work.filter((work) => work.status === status).length,
				]),
			) as Record<WorkStatus, number>,
		[state.work],
	);

	return (
		<main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,color-mix(in_oklch,var(--primary)_10%,transparent),transparent_36rem),var(--background)] text-foreground">
			<div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
				<Header state={state} />
				<section className="grid gap-3 md:grid-cols-4">
					<Metric
						label="Last tick"
						value={state.loop.lastTick}
						detail="reconcile complete"
					/>
					<Metric
						label="Next wake"
						value={state.loop.nextWake}
						detail="source timer"
					/>
					<Metric
						label="Dispatch"
						value={`${state.loop.dispatched}/${state.loop.selected}`}
						detail="selected work started"
					/>
					<Metric
						label="Deferred"
						value={String(state.loop.deferred)}
						detail="capacity or policy"
					/>
				</section>
				<section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)_20rem]">
					<aside className="min-h-0 rounded-2xl border border-border/70 bg-card/80 shadow-[0_24px_80px_rgb(0_0_0_/_0.08)] backdrop-blur">
						<WorkList
							counts={counts}
							onSelectWork={setSelectedWorkId}
							selectedWorkId={selectedWork?.id}
							work={state.work}
						/>
					</aside>
					<section className="min-w-0 rounded-2xl border border-border/70 bg-card/80 shadow-[0_24px_80px_rgb(0_0_0_/_0.08)] backdrop-blur">
						{selectedWork == null ? (
							<EmptyDetail />
						) : (
							<WorkDetail work={selectedWork} />
						)}
					</section>
					<aside className="grid min-h-0 gap-4 lg:grid-rows-[auto_1fr]">
						<SourcesPanel sources={state.sources} />
						<EventsPanel
							events={state.recentEvents}
							diagnostics={state.diagnostics}
						/>
					</aside>
				</section>
			</div>
		</main>
	);
}

function Header({ state }: { state: PlotDashboardState }) {
	return (
		<header className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-[0_24px_80px_rgb(0_0_0_/_0.08)] backdrop-blur md:flex-row md:items-center md:justify-between">
			<div className="min-w-0">
				<div className="mb-2 flex flex-wrap items-center gap-2">
					<span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
						<span className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_12px_var(--color-emerald-500)]" />
						{state.session.state}
					</span>
					<span className="font-mono text-xs text-muted-foreground">
						{state.session.workflowPath}
					</span>
				</div>
				<h1 className="truncate text-2xl font-semibold tracking-[-0.04em] md:text-3xl">
					Plot operations cockpit
				</h1>
				<p className="mt-1 max-w-2xl text-sm text-muted-foreground">
					A product-model-first view of tick → reconcile → act. This mock
					exposes what the web app should project from plot.v1 before we wire
					live transport.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="outline" size="sm">
					<Clock3 className="size-4" /> Tick once
				</Button>
				<Button size="sm">
					<Sparkles className="size-4" /> Live mock
				</Button>
			</div>
		</header>
	);
}

function Metric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-border/70 bg-card/70 p-4 shadow-[0_16px_50px_rgb(0_0_0_/_0.06)] backdrop-blur">
			<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
				{label}
			</p>
			<div className="mt-2 flex items-end justify-between gap-3">
				<p className="text-2xl font-semibold tracking-[-0.04em]">{value}</p>
				<p className="pb-1 text-xs text-muted-foreground">{detail}</p>
			</div>
		</div>
	);
}

function WorkList({
	counts,
	onSelectWork,
	selectedWorkId,
	work,
}: {
	counts: Record<WorkStatus, number>;
	onSelectWork(id: string): void;
	selectedWorkId: string | undefined;
	work: WorkItemSummary[];
}) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-border/70 p-4">
				<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
					Work
				</p>
				<div className="mt-3 grid grid-cols-5 gap-1">
					{statusOrder.map((status) => (
						<div
							key={status}
							className="rounded-lg border border-border/60 p-2 text-center"
						>
							<p className="text-sm font-semibold">{counts[status]}</p>
							<p className="truncate text-[10px] text-muted-foreground">
								{statusLabels[status]}
							</p>
						</div>
					))}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto p-2">
				{statusOrder.map((status) => {
					const items = work.filter((item) => item.status === status);
					if (items.length === 0) return null;
					return (
						<div key={status} className="mb-3">
							<div className="px-2 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
								{statusLabels[status]}
							</div>
							<div className="space-y-1">
								{items.map((item) => (
									<button
										key={item.id}
										type="button"
										onClick={() => onSelectWork(item.id)}
										className={cn(
											"group w-full rounded-xl border p-3 text-left transition hover:bg-accent/60",
											selectedWorkId === item.id
												? "border-primary/30 bg-accent shadow-sm"
												: "border-transparent",
										)}
									>
										<div className="flex items-center justify-between gap-2">
											<p className="line-clamp-1 text-sm font-medium">
												{item.title}
											</p>
											<StatusPill status={item.status} />
										</div>
										<p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
											{item.activity}
										</p>
										<p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/80">
											{item.key}
										</p>
									</button>
								))}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function WorkDetail({ work }: { work: WorkItemSummary }) {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="border-b border-border/70 p-5">
				<div className="flex flex-wrap items-center gap-2">
					<StatusPill status={work.status} />
					<span className="rounded-full border border-border/70 px-2 py-1 text-xs text-muted-foreground">
						attempt {work.attempt}
					</span>
					{work.runId == null ? null : (
						<span className="rounded-full border border-border/70 px-2 py-1 font-mono text-xs text-muted-foreground">
							{work.runId}
						</span>
					)}
				</div>
				<div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div className="min-w-0">
						<h2 className="text-2xl font-semibold tracking-[-0.04em]">
							{work.title}
						</h2>
						<p className="mt-1 font-mono text-xs text-muted-foreground">
							{work.key}
						</p>
					</div>
					{work.url == null ? null : (
						<Button asChild variant="outline" size="sm">
							<a href={work.url} target="_blank" rel="noreferrer">
								Open <ArrowUpRight className="size-3.5" />
							</a>
						</Button>
					)}
				</div>
			</div>
			<div className="grid min-h-0 flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="min-h-0 overflow-auto p-5">
					<section className="rounded-2xl border border-border/70 bg-background/40 p-4">
						<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
							Why this state?
						</p>
						<p className="mt-3 text-sm leading-6">{work.reason}</p>
					</section>
					<section className="mt-4 rounded-2xl border border-border/70 bg-background/40 p-4">
						<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
							Timeline
						</p>
						<div className="mt-4 space-y-4">
							{work.timeline.map((event) => (
								<TimelineEventRow key={event.id} event={event} />
							))}
						</div>
					</section>
				</div>
				<div className="border-t border-border/70 bg-[var(--diffshub-sidebar-bg)] p-4 lg:border-t-0 lg:border-l">
					<Fact label="Source" value={work.sourceLabel} />
					<Fact label="Current activity" value={work.activity} />
					<Fact label="Owner" value="Plot agent" />
					<Fact label="Runtime seam" value="source selects, runner executes" />
				</div>
			</div>
		</div>
	);
}

function SourcesPanel({ sources }: { sources: SourceSummary[] }) {
	return (
		<section className="rounded-2xl border border-border/70 bg-card/80 p-4 shadow-[0_24px_80px_rgb(0_0_0_/_0.08)] backdrop-blur">
			<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
				Sources
			</p>
			<div className="mt-3 space-y-2">
				{sources.map((source) => (
					<div
						key={source.id}
						className="rounded-xl border border-border/70 p-3"
					>
						<div className="flex items-center justify-between gap-2">
							<p className="line-clamp-1 text-sm font-medium">{source.label}</p>
							<span className="text-xs text-muted-foreground">
								{source.status}
							</span>
						</div>
						<p className="mt-2 font-mono text-[11px] text-muted-foreground">
							{source.id}
						</p>
						<p className="mt-2 text-xs text-muted-foreground">
							{source.runningWork} running · {source.readyWork} ready
						</p>
					</div>
				))}
			</div>
		</section>
	);
}

function EventsPanel({
	diagnostics,
	events,
}: {
	diagnostics: PlotDashboardState["diagnostics"];
	events: WorkTimelineEvent[];
}) {
	return (
		<section className="min-h-0 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-[0_24px_80px_rgb(0_0_0_/_0.08)] backdrop-blur">
			<p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
				Recent protocol projection
			</p>
			<div className="mt-4 space-y-4">
				{events.map((event) => (
					<TimelineEventRow key={event.id} event={event} compact />
				))}
			</div>
			{diagnostics.length === 0 ? null : (
				<div className="mt-5 border-t border-border/70 pt-4">
					<p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
						Diagnostics
					</p>
					{diagnostics.map((diagnostic) => (
						<div
							key={diagnostic.id}
							className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm"
						>
							<p className="font-medium text-amber-700 dark:text-amber-300">
								{diagnostic.title}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{diagnostic.detail}
							</p>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

function TimelineEventRow({
	compact = false,
	event,
}: {
	compact?: boolean;
	event: WorkTimelineEvent;
}) {
	const Icon = timelineIcons[event.kind];
	return (
		<div className="flex gap-3">
			<div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background">
				<Icon className="size-3.5 text-muted-foreground" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center justify-between gap-3">
					<p className="text-sm font-medium">{event.title}</p>
					<span className="shrink-0 text-xs text-muted-foreground">
						{event.time}
					</span>
				</div>
				<p
					className={cn(
						"mt-1 text-sm text-muted-foreground",
						compact && "line-clamp-2 text-xs",
					)}
				>
					{event.detail}
				</p>
			</div>
		</div>
	);
}

function StatusPill({ status }: { status: WorkStatus }) {
	const Icon =
		status === "completed"
			? CheckCircle2
			: status === "blocked"
				? PauseCircle
				: status === "running"
					? Activity
					: CircleDot;
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
				statusStyles[status],
			)}
		>
			<Icon className="size-3" />
			{status}
		</span>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="border-b border-border/60 py-3 last:border-0">
			<p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 text-sm">{value}</p>
		</div>
	);
}

function EmptyDetail() {
	return (
		<div className="flex h-full items-center justify-center p-8 text-center text-muted-foreground">
			No work selected.
		</div>
	);
}
