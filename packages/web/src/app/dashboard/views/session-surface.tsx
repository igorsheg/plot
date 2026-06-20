import {
	dashboardModelFrom,
	formatDuration,
	type WorkRowModel,
} from "@plot/control/dashboard-model";
import type { DashboardProjection } from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Sparkline } from "@/components/ui/sparkline";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { throughputSeries } from "../throughput-series";
import { InterruptRunButton, OperatorActionButtons } from "./operator-actions";

const mono = "font-mono tabular-nums";

// hairline divider between inline meta segments (a 4px-rhythm column rule).
function Divided({ children }: { children: readonly ReactNode[] }) {
	return (
		<>
			{children.map((child, index) => (
				<Fragment key={index}>
					{index > 0 ? (
						<span className="mx-3 h-2 w-px self-center bg-border" />
					) : null}
					{child}
				</Fragment>
			))}
		</>
	);
}

export function SessionSurface() {
	const { roster, selectedSessionId, projection, lastError } =
		useDashboardState();
	const session = roster.find(
		(candidate) => candidate.id === selectedSessionId,
	);
	if (session === undefined && projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;

	return (
		<div className="flex flex-col">
			<div className="px-6 pt-5">
				<Link
					to="/"
					search={(prev) => ({ role: prev.role ?? "controller" })}
					className="inline-flex items-center gap-2 text-2xs text-t3 transition-colors hover:text-foreground"
				>
					<ArrowLeft size={13} /> all sessions
				</Link>
			</div>
			{projection === undefined ? (
				<div className="px-6">
					<SnapshotUnavailable lastError={lastError} />
				</div>
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
	const model = useMemo(() => dashboardModelFrom(projection), [projection]);
	const samples = projection.tokenSamples;
	const tps = useMemo(() => {
		const last = samples[samples.length - 1];
		return last === undefined ? [] : throughputSeries(samples, last.atMs);
	}, [samples]);
	const idle = model.work.length === 0;
	// Stable insertion order, not the model's attention-first sort: the
	// AttentionBand already surfaces what needs you, and reordering blocked
	// rows to the top is what makes the list jump as agents stream.
	const work = useMemo(
		() =>
			model.work.toSorted(
				(a, b) =>
					(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
			),
		[model.work],
	);
	const agentsActive = session?.agents.active ?? model.pulse.runningCount;
	const agentsMax = session?.agents.max ?? model.pulse.maxConcurrentRuns;
	const paused = session?.state === "paused" || projection.status === "paused";
	const stopped =
		session?.state === "stopped" || projection.status === "stopped";

	return (
		<div className="mt-3 flex flex-col">
			{/* status bar — the one always-dense strip */}
			<div className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-background px-6">
				<span className="size-1.5 shrink-0 rounded-full bg-live" />
				<h1 className="text-sm font-medium tracking-[-0.01em]">
					{projection.workflowName}
				</h1>
				<span className={cn("text-2xs text-t3", mono)}>
					<span className="capitalize">
						{session?.state ?? projection.status}
					</span>
					{projection.runtime.model ? ` · ${projection.runtime.model}` : ""}
				</span>
				{session?.cwdName ? (
					<span
						className={cn("hidden truncate text-2xs text-t3 sm:inline", mono)}
					>
						{session.cwdName}
					</span>
				) : null}

				<div className={cn("ml-auto flex items-center text-2xs text-t3", mono)}>
					<Divided>
						{[
							<>
								<b className="font-normal text-muted-foreground">
									{agentsActive}
								</b>
								/{agentsMax ?? "n/a"} agents
							</>,
							<span className="flex items-center gap-2">
								<Sparkline data={tps} />
								<span className="text-muted-foreground">
									{model.pulse.throughput.replace("tps", "tok/s")}
								</span>
							</span>,
							<>
								<b className="font-normal text-muted-foreground">
									{model.pulse.totalTokens}
								</b>{" "}
								tok
								{model.pulse.totalCost ? ` · ${model.pulse.totalCost}` : ""}
							</>,
						]}
					</Divided>
				</div>
			</div>

			<div className="flex items-center justify-between gap-3 px-6 pt-3 text-2xs">
				<SessionControls
					projection={projection}
					paused={paused}
					stopped={stopped}
				/>
				{idle ? <WatchingMeta model={model} /> : null}
			</div>

			{model.attention.length > 0 ? (
				<AttentionBand model={model} sessionId={projection.sessionId} />
			) : null}

			<div className="px-6 pt-6 pb-2 text-2xs text-t3">
				{idle ? "watching" : `work · ${model.work.length}`}
			</div>
			{idle ? (
				<IdleList model={model} />
			) : (
				work.map((row) => (
					<WorkLane
						key={row.work.workKey}
						row={row}
						sessionId={projection.sessionId}
					/>
				))
			)}
		</div>
	);
}

// When idle, the schedule + last run is the only thing worth watching. Mirrors
// the TUI's "watching" block: tick/next-tick/next-wake and the most recent run.
function WatchingMeta({
	model,
}: {
	model: ReturnType<typeof dashboardModelFrom>;
}) {
	const parts: ReactNode[] = [];
	const tick = model.pulse.tick;
	if (tick !== undefined)
		parts.push(
			<>
				tick #{tick.id} · {tick.ago}
			</>,
		);
	if (model.pulse.nextTick !== undefined)
		parts.push(<>next tick in {model.pulse.nextTick.inSeconds}s</>);
	if (model.pulse.nextWake !== undefined) {
		const wake = model.pulse.nextWake;
		parts.push(
			<>
				{wake.kind === "retry" ? "retry" : "next wake"} in {wake.inSeconds}s
			</>,
		);
	}
	if (parts.length === 0) return null;
	return (
		<span className={cn("text-t3", mono)}>
			<Divided>{parts}</Divided>
		</span>
	);
}

function AttentionBand({
	model,
	sessionId,
}: {
	model: ReturnType<typeof dashboardModelFrom>;
	sessionId: string;
}) {
	const actionable = model.work.filter((row) => row.attention);
	return (
		<div className="relative mt-6 border-y border-border bg-attention/5 px-6 py-4">
			<span className="absolute inset-y-0 left-0 w-0.5 bg-attention" />
			<div className={cn("mb-2 text-2xs text-attention", mono)}>attention</div>
			<div className="flex flex-col gap-3">
				{model.attention.map((entry, index) => {
					const row = actionable.find((r) => r.work.workKey === entry.workKey);
					return (
						<div
							key={`${entry.workKey ?? "diag"}-${index}`}
							className="flex flex-wrap items-center justify-between gap-3"
						>
							<p className="min-w-0 text-2xs text-muted-foreground">
								{entry.text}
							</p>
							{row ? (
								<OperatorActionButtons
									item={row.work}
									sessionId={sessionId}
									prominent
								/>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

const railTone = (row: WorkRowModel) =>
	row.attention
		? "bg-attention"
		: row.stale
			? "bg-border"
			: row.attempt?.streaming
				? "bg-live"
				: "bg-border";

function WorkLane({
	row,
	sessionId,
}: {
	row: WorkRowModel;
	sessionId: string;
}) {
	const attempt = row.attempt;
	const live = attempt?.streaming ?? false;
	const [open, setOpen] = useState(live || row.attention);
	return (
		<div className={cn("group border-t border-border", live && "bg-live/5")}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="grid w-full grid-cols-[3px_1fr_auto_16px] items-center gap-x-4 px-6 py-4 text-left transition-colors hover:bg-hover"
			>
				<span className={cn("h-6 w-[3px] rounded-[3px]", railTone(row))} />
				<div className="min-w-0">
					<span
						className={cn(
							"weight-hover truncate text-sm",
							row.stale && "text-muted-foreground",
						)}
					>
						{row.label}
					</span>
					<p
						className={cn(
							"mt-1 truncate text-2xs",
							mono,
							live ? "shimmer-text" : "text-t3",
						)}
					>
						{row.activity}
					</p>
				</div>
				<div
					className={cn(
						"flex items-baseline justify-self-end whitespace-nowrap text-2xs text-t3 opacity-0 transition-opacity group-hover:opacity-100",
						open && "opacity-100",
						mono,
					)}
				>
					{row.meta.length > 0 ? row.meta : null}
				</div>
				<ChevronRight
					size={14}
					className={cn(
						"text-t3 opacity-0 transition group-hover:opacity-100",
						open && "rotate-90 opacity-100",
					)}
				/>
			</button>

			{open ? (
				<div className="px-6 pb-6 pl-10 text-2xs">
					<Trail row={row} />
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<OperatorActionButtons item={row.work} sessionId={sessionId} />
						{attempt === undefined ? null : (
							<InterruptRunButton
								item={row.work}
								attempt={attempt}
								sessionId={sessionId}
							/>
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

// The trail: a bottom-anchored rolling window over the timeline, the way the
// TUI streams it. Newest sits at the bottom and the live "now" line is pinned
// last — new entries append above the live line, old ones fall off the top, so
// nothing shifts position. The age column is a fixed-width track (formatDuration,
// no "ago" suffix) so ages tick in place without reflowing the text column, and
// keys are stable (atMs, not the age that changes every tick) so React reuses
// the DOM instead of remounting/reordering it on every coalesced frame.
const trailWindow = 9;

function Trail({ row }: { row: WorkRowModel }) {
	const attempt = row.attempt;
	if (attempt === undefined)
		return <p className="text-2xs text-t3">No activity yet.</p>;

	const history = [...attempt.timeline]
		.toSorted((a, b) => a.atMs - b.atMs)
		.slice(-trailWindow);
	if (history.length === 0 && !attempt.streaming)
		return <p className="text-2xs text-t3">No activity yet.</p>;

	return (
		<div className={cn("mb-5", mono)}>
			<div className={cn("mb-3 text-t3", mono)}>
				timeline · {attempt.meaningfulCount} of {attempt.eventCount} events
			</div>
			<div className="grid grid-cols-[7ch_1fr] gap-x-3">
				{history.map((entry) => (
					<Fragment key={`${entry.atMs}-${entry.kind}`}>
						<span className="text-2xs text-t3">
							{formatDuration(Date.now() - entry.atMs)}
						</span>
						<span className="truncate text-2xs text-muted-foreground">
							{entry.text}
						</span>
					</Fragment>
				))}
				{attempt.streaming ? (
					<Fragment key="live">
						<span className="text-2xs text-foreground">now</span>
						<span className="truncate text-2xs text-foreground shimmer-text">
							{row.activity}
						</span>
					</Fragment>
				) : null}
			</div>
		</div>
	);
}

function SessionControls({
	projection,
	paused,
	stopped,
}: {
	projection: DashboardProjection;
	paused: boolean;
	stopped: boolean;
}) {
	const sessionId = projection.sessionId;
	const { mutateSession } = useDashboardActions();
	const { isController, controllerBlockReason } = useDashboardMeta();
	const { mutationError } = useDashboardState();
	const [closeOpen, setCloseOpen] = useState(false);

	return (
		<>
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
			</div>
			<div className="flex items-center gap-3">
				{controllerBlockReason ? (
					<span className="text-t3">{controllerBlockReason}</span>
				) : null}
				{mutationError ? (
					<span className="text-destructive">{mutationError}</span>
				) : null}
			</div>

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
		</>
	);
}

// Idle: the last completed run + scheduled retries. Nothing else — the schedule
// and the most recent outcome are the only things that matter when no work is
// running. Active work suppresses both (see WatchingMeta/AttentionBand).
function IdleList({ model }: { model: ReturnType<typeof dashboardModelFrom> }) {
	const last = model.completed[0];
	const scheduled = model.scheduled;
	return (
		<>
			{last === undefined ? (
				<p className="border-t border-border px-6 py-4 text-2xs text-t3">
					No active work.
				</p>
			) : (
				<LastRun row={last} />
			)}
			{scheduled.length > 0 ? (
				<>
					<div className="px-6 pt-6 pb-2 text-2xs text-t3">retry</div>
					{scheduled.map((wake) => (
						<div
							key={`${wake.workKey ?? "session"}-${wake.inSeconds}`}
							className="flex items-baseline justify-between gap-3 border-t border-border px-6 py-3"
						>
							<span className={cn("text-2xs text-muted-foreground", mono)}>
								↻ {wake.label ?? wake.workKey ?? "session"}
							</span>
							<span className={cn("shrink-0 text-2xs text-t3", mono)}>
								attempt {wake.attempt ?? "n/a"} · in {wake.inSeconds}s
								{wake.reason ? ` · ${wake.reason}` : ""}
							</span>
						</div>
					))}
				</>
			) : null}
		</>
	);
}

function LastRun({
	row,
}: {
	row: ReturnType<typeof dashboardModelFrom>["completed"][number];
}) {
	const ok = row.tone === "ok";
	const message =
		row.message === "completed" || row.message === row.status
			? undefined
			: row.message;
	const right = ok
		? (row.meta ?? row.ago)
		: [
				row.status,
				...(message === undefined ? [] : [message]),
				row.meta ?? row.ago,
			].join(" · ");
	return (
		<div className="grid grid-cols-[3px_1fr_auto] items-center gap-x-4 border-t border-border px-6 py-3">
			<span className="h-5 w-[3px] rounded-[3px] bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]" />
			<span className="truncate text-sm text-muted-foreground">
				{row.label}
			</span>
			<span className={cn("shrink-0 text-2xs text-t3", mono)}>
				<span className={ok ? "text-t3" : "text-destructive"}>
					{ok ? row.status : (message ?? row.status)}
				</span>{" "}
				· {right}
			</span>
		</div>
	);
}

function SnapshotUnavailable({
	lastError,
}: {
	lastError?: string | undefined;
}) {
	return (
		<div className="space-y-2 py-4 text-2xs text-t3">
			<p>Snapshot unavailable for this Plot Session.</p>
			{lastError ? <p>{lastError}</p> : null}
		</div>
	);
}
