import {
	dashboardModelFrom,
	formatAgo,
	formatDuration,
	formatTokens,
} from "@plot/control/dashboard-model";
import {
	type ActivityKind,
	type DashboardProjection,
	type RunningWorkProjection,
	workLabel,
} from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputCopy } from "@/components/ui/input-copy";
import { Sparkline } from "@/components/ui/sparkline";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { projectionReadyDoneCounts } from "../fleet-model";
import { throughputSeries } from "../throughput-series";
import { InterruptRunButton, OperatorActionButtons } from "./operator-actions";

const tabular = "font-mono tabular-nums";
const muted = "text-muted-foreground";
// Bleed lanes to the edge of the max-w-5xl px-6 reading column.
const bleed = "-mx-6";

export function SessionSurface() {
	const { roster, selectedSessionId, projection, lastError } =
		useDashboardState();
	const session = roster.find(
		(candidate) => candidate.id === selectedSessionId,
	);
	if (session === undefined && projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;

	return (
		<div className="flex flex-col gap-5">
			<Link
				to="/"
				search={(prev) => ({ role: prev.role ?? "controller" })}
				className="inline-flex items-center gap-2 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<ArrowLeft size={14} /> all sessions
			</Link>
			{projection === undefined ? (
				<SnapshotUnavailable lastError={lastError} />
			) : (
				<SessionDetail projection={projection} session={session} />
			)}
		</div>
	);
}

function SessionDetail({
	projection,
	session,
}: {
	projection: DashboardProjection;
	session?: PlotSessionSummary;
}) {
	const model = dashboardModelFrom(projection);
	const counts = projectionReadyDoneCounts(projection);
	const samples = projection.tokenSamples;
	const tps = useMemo(() => {
		const last = samples[samples.length - 1];
		return last === undefined ? [] : throughputSeries(samples, last.atMs);
	}, [samples]);
	const work = [...projection.running.values()].toSorted(
		(a, b) =>
			Number(needsAttention(b)) - Number(needsAttention(a)) ||
			a.startedAtSeq - b.startedAtSeq,
	);
	const needs = work.filter(needsAttention);

	return (
		<div className="flex flex-col">
			{/* status bar — the one always-dense strip */}
			<div className={cn(bleed, "border-b border-border px-6 pb-4")}>
				<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
					<h1 className="text-lg font-semibold tracking-[-0.02em]">
						{projection.workflowName}
					</h1>
					<div
						className={cn(
							"flex flex-wrap items-center gap-x-4 gap-y-1 text-xs",
							muted,
						)}
					>
						<span className={tabular}>
							agents {session?.agents.active ?? model.pulse.runningCount}/
							{session?.agents.max ?? model.pulse.maxConcurrentRuns ?? "n/a"}
						</span>
						<span className="flex items-center gap-2">
							<Sparkline data={tps} />
							<span className={tabular}>
								{model.pulse.throughput.replace("tps", "tok/s")}
							</span>
						</span>
						<span className={tabular}>
							{model.pulse.totalTokens} tok
							{model.pulse.totalCost ? ` · ${model.pulse.totalCost}` : ""}
						</span>
						<span className={tabular}>
							ready {counts.ready} · done {counts.done}
						</span>
					</div>
				</div>
				<div className={cn("mt-1 text-xs", muted)}>
					<span className="capitalize">
						{session?.state ?? projection.status}
					</span>
					{projection.runtime.model ? (
						<span className={cn("ml-2", tabular)}>
							· {projection.runtime.model}
							{projection.runtime.thinking
								? ` · thinking ${projection.runtime.thinking}`
								: ""}
						</span>
					) : null}
				</div>
			</div>

			{session?.cwd ? (
				<div className="px-0 pt-4">
					<InputCopy value={session.cwd} variant="icon" className="max-w-xl" />
				</div>
			) : null}

			<div className="pt-3">
				<SessionControls session={session} projection={projection} />
			</div>

			{needs.length > 0 ? (
				<NeedsYouBand needs={needs} sessionId={projection.sessionId} />
			) : null}

			{/* lanes */}
			<div className={cn(bleed, "mt-5")}>
				<div
					className={cn("px-6 pb-1 text-2xs uppercase tracking-wider", muted)}
				>
					running · {work.length}
				</div>
				{work.length === 0 ? (
					<p className={cn("border-t border-border px-6 py-4 text-sm", muted)}>
						No active work.
					</p>
				) : (
					work.map((item) => (
						<WorkLane
							key={item.workKey}
							work={item}
							sessionId={projection.sessionId}
						/>
					))
				)}
			</div>

			<DoneSection projection={projection} />
			<RetrySection projection={projection} />
		</div>
	);
}

const needsAttention = (work: RunningWorkProjection) =>
	work.stage === "blocked" ||
	work.stage === "failed" ||
	(work.operatorActions?.length ?? 0) > 0;

// stage / check word colours: success is the expected outcome and gets no
// colour; only exceptions (needs-you, failure) are tinted.
function stageTone(work: RunningWorkProjection): string {
	if (work.stage === "blocked") return "text-attention";
	if (work.stage === "failed") return "text-destructive";
	if (work.streaming) return "text-foreground";
	return muted;
}

function StageRail({ work }: { work: RunningWorkProjection }) {
	const tone =
		work.stage === "blocked"
			? "bg-attention"
			: work.stage === "failed"
				? "bg-destructive"
				: work.streaming
					? "bg-foreground"
					: "bg-border";
	return <span className={cn("h-6 w-[3px] shrink-0 rounded-full", tone)} />;
}

function WorkLane({
	work,
	sessionId,
}: {
	work: RunningWorkProjection;
	sessionId: string;
}) {
	const [open, setOpen] = useState(work.streaming || needsAttention(work));
	const age =
		work.startedAtMs === undefined
			? "n/a"
			: formatDuration(Date.now() - work.startedAtMs);
	const tokens =
		work.tokens?.total === undefined
			? undefined
			: formatTokens(work.tokens.total);

	return (
		<div
			className={cn(
				"group border-t border-border",
				work.streaming && "bg-muted/40",
			)}
		>
			{/* level 1 (rest) + level 2 (hover) */}
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-hover"
			>
				<StageRail work={work} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="weight-hover truncate text-sm">
							{workLabel(work)}
						</span>
						<span className={cn("shrink-0 text-2xs", tabular, "text-border")}>
							{work.workKey}
						</span>
					</div>
					<p
						className={cn(
							"mt-0.5 truncate text-xs",
							work.streaming ? "shimmer-text" : muted,
						)}
					>
						{work.activity || work.lastMeaningful}
					</p>
				</div>
				<div className="flex shrink-0 items-baseline gap-3">
					<span
						className={cn(
							"hidden items-baseline gap-3 text-2xs opacity-0 transition-opacity group-hover:opacity-100 sm:flex",
							open && "opacity-100",
							tabular,
							muted,
						)}
					>
						<span>t{work.turnCount}</span>
						<span>{tokens ?? "—"}</span>
						<CheckBadge work={work} />
						<span>{age}</span>
						<span className="text-border">{work.runId}</span>
					</span>
					<span className={cn("text-2xs", stageTone(work))}>{work.stage}</span>
					<ChevronRight
						size={14}
						className={cn(
							"text-muted-foreground opacity-0 transition group-hover:opacity-100",
							open && "rotate-90 opacity-100",
						)}
					/>
				</div>
			</button>

			{/* level 3 (open) */}
			{open ? (
				<div className="px-6 pb-5 pl-11">
					{work.phases.length > 0 ? <Spine work={work} /> : null}
					<div className="grid gap-6 md:grid-cols-[1.5fr_1fr_1fr]">
						<Timeline work={work} />
						<Commands work={work} />
						<Observations work={work} />
					</div>
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<OperatorActionButtons item={work} sessionId={sessionId} />
						<InterruptRunButton item={work} sessionId={sessionId} />
					</div>
				</div>
			) : null}
		</div>
	);
}

function CheckBadge({ work }: { work: RunningWorkProjection }) {
	if (work.check === "not-run") return null;
	if (work.check === "failed")
		return <span className="text-destructive">check failed</span>;
	if (work.check === "running") return <span>check running</span>;
	return <span>passed</span>;
}

// coalesced phases as proportional segments; the current (last) phase reads in
// the foreground while it streams.
function Spine({ work }: { work: RunningWorkProjection }) {
	const total = work.phases.reduce((sum, phase) => sum + phase.count, 0) || 1;
	return (
		<div className="mb-4 mt-1">
			<div className="flex h-1 gap-0.5">
				{work.phases.map((phase, index) => {
					const current = index === work.phases.length - 1 && work.streaming;
					return (
						<span
							key={`${phase.kind}-${phase.startedAtMs}`}
							className={cn(
								"rounded-full",
								current ? "bg-foreground" : "bg-border",
							)}
							style={{ flexGrow: Math.max(1, (phase.count / total) * 100) }}
						/>
					);
				})}
			</div>
			<div
				className={cn(
					"mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs",
					tabular,
					muted,
				)}
			>
				{work.phases.map((phase) => (
					<span key={`label-${phase.kind}-${phase.startedAtMs}`}>
						{kindLabel(phase.kind)}
						<span className="text-border"> ·{phase.count}</span>
					</span>
				))}
			</div>
		</div>
	);
}

function kindLabel(kind: ActivityKind): string {
	return kind;
}

function Timeline({ work }: { work: RunningWorkProjection }) {
	const ordered = [...work.timeline].toSorted((a, b) => b.atMs - a.atMs);
	return (
		<div>
			<div className={cn("mb-3 text-2xs", muted)}>
				timeline
				<span className="text-border">
					{" "}
					· {work.meaningfulCount} of {work.eventCount} events
				</span>
			</div>
			{ordered.length === 0 ? (
				<p className={cn("text-xs", muted)}>No activity yet.</p>
			) : (
				<div className="flex flex-col gap-1">
					{ordered.map((entry, index) => (
						<div
							key={`${entry.atMs}-${entry.text}`}
							className="grid grid-cols-[10px_1fr_auto] items-baseline gap-2"
						>
							<span
								className={cn(
									"size-1.5 justify-self-center self-center rounded-full",
									index === 0 && work.streaming ? "bg-foreground" : "bg-border",
								)}
							/>
							<span className="text-xs text-foreground">{entry.text}</span>
							<span className={cn("text-2xs", tabular, "text-border")}>
								{formatAgo(Date.now() - entry.atMs)}
							</span>
						</div>
					))}
				</div>
			)}
		</div>
	);
}

function Commands({ work }: { work: RunningWorkProjection }) {
	if (work.commands.length === 0) return null;
	return (
		<div>
			<div className={cn("mb-3 text-2xs", muted)}>commands</div>
			<div className="flex flex-col gap-1.5">
				{work.commands.map((command, index) => (
					<div
						key={`${index}-${command}`}
						className={cn("truncate text-xs", tabular, muted)}
					>
						<span className="text-foreground">$</span> {command}
					</div>
				))}
			</div>
		</div>
	);
}

function Observations({ work }: { work: RunningWorkProjection }) {
	if (work.observations.length === 0) return null;
	return (
		<div>
			<div className={cn("mb-3 text-2xs", muted)}>observations</div>
			<div className="flex flex-col gap-2">
				{work.observations.map((observation, index) => (
					<div
						key={`${index}-${observation}`}
						className="flex items-start gap-2 text-xs"
					>
						<span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
						<span>{observation}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function NeedsYouBand({
	needs,
	sessionId,
}: {
	needs: readonly RunningWorkProjection[];
	sessionId: string;
}) {
	return (
		<div
			className={cn(
				bleed,
				"mt-5 border-y border-attention/30 bg-attention/5 px-6 py-4",
			)}
		>
			<div className="text-2xs uppercase tracking-wider text-attention">
				needs you
			</div>
			<div className="mt-3 flex flex-col gap-3">
				{needs.map((item) => (
					<div
						key={item.workKey}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						<div className="min-w-0">
							<p className="text-sm font-medium">{workLabel(item)}</p>
							<p className={cn("text-xs", muted)}>{item.lastMeaningful}</p>
						</div>
						<OperatorActionButtons
							item={item}
							sessionId={sessionId}
							prominent
						/>
					</div>
				))}
			</div>
		</div>
	);
}

function SessionControls({
	session,
	projection,
}: {
	session?: PlotSessionSummary;
	projection: DashboardProjection;
}) {
	const sessionId = projection.sessionId;
	const { mutateSession } = useDashboardActions();
	const { isController, controllerBlockReason } = useDashboardMeta();
	const { mutationError } = useDashboardState();
	const [closeOpen, setCloseOpen] = useState(false);

	const paused = session?.state === "paused" || projection.status === "paused";
	const stopped =
		session?.state === "stopped" || projection.status === "stopped";

	return (
		<div className="flex flex-wrap items-center justify-between gap-3 text-xs">
			<div className="flex flex-wrap items-center gap-4">
				<Switch
					label={paused ? "Paused" : "Running"}
					checked={!paused}
					disabled={!isController || stopped}
					onToggle={() =>
						mutateSession(
							sessionId,
							paused ? "resume_session" : "pause_session",
						)
					}
				/>
				<Button
					size="sm"
					variant="tertiary"
					disabled={!isController || paused || stopped}
					onClick={() => mutateSession(sessionId, "request_tick")}
				>
					Reconcile now
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="text-destructive"
					disabled={!isController || stopped}
					onClick={() => setCloseOpen(true)}
				>
					Close session
				</Button>
				<Dialog open={closeOpen} onOpenChange={setCloseOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Close this Plot Session?</DialogTitle>
							<DialogDescription>
								Active Agent Runs will be interrupted; Session History is kept.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button
								size="sm"
								variant="tertiary"
								onClick={() => setCloseOpen(false)}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="primary"
								className="bg-destructive text-white"
								onClick={() => {
									mutateSession(sessionId, "close_session");
									setCloseOpen(false);
								}}
							>
								Close session
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
			{controllerBlockReason ? (
				<span className={muted}>{controllerBlockReason}</span>
			) : null}
			{mutationError ? (
				<span className="text-destructive">{mutationError}</span>
			) : null}
		</div>
	);
}

function DoneSection({ projection }: { projection: DashboardProjection }) {
	if (projection.completed.length === 0) return null;
	return (
		<div className={cn(bleed, "mt-5")}>
			<div className={cn("px-6 pb-1 text-2xs uppercase tracking-wider", muted)}>
				done · {projection.completed.length}
			</div>
			{projection.completed.slice(0, 8).map((entry) => (
				<div
					key={`${entry.workKey}-${entry.atMs}`}
					className="flex items-baseline justify-between gap-3 border-t border-border px-6 py-3"
				>
					<span className={cn("truncate text-sm", muted)}>{entry.label}</span>
					<span className={cn("shrink-0 text-2xs", tabular)}>
						<span
							className={
								entry.status === "succeeded" ? muted : "text-destructive"
							}
						>
							{entry.status === "succeeded" ? entry.status : entry.message}
						</span>
						<span className="text-border">
							{" "}
							· {formatAgo(Date.now() - entry.atMs)}
						</span>
					</span>
				</div>
			))}
		</div>
	);
}

function RetrySection({ projection }: { projection: DashboardProjection }) {
	if (projection.scheduledWakes.length === 0) return null;
	return (
		<div className={cn(bleed, "mt-5")}>
			<div className={cn("px-6 pb-1 text-2xs uppercase tracking-wider", muted)}>
				retry
			</div>
			{projection.scheduledWakes.map((wake) => (
				<div
					key={`${wake.dueAtMs}-${wake.workKey ?? "session"}`}
					className="flex items-baseline justify-between gap-3 border-t border-border px-6 py-3"
				>
					<span className={cn("text-sm", tabular)}>
						↻ {wake.workKey ?? "session"}
					</span>
					<span className={cn("shrink-0 text-2xs", tabular, muted)}>
						attempt {wake.attempt ?? "n/a"} · in{" "}
						{formatDuration(wake.dueAtMs - Date.now())} · {wake.reason ?? "n/a"}
					</span>
				</div>
			))}
		</div>
	);
}

function SnapshotUnavailable({
	lastError,
}: {
	lastError?: string | undefined;
}) {
	return (
		<div className={cn("space-y-2 py-4 text-sm", muted)}>
			<p>Snapshot unavailable for this Plot Session.</p>
			{lastError ? <p>{lastError}</p> : null}
		</div>
	);
}
