import {
	dashboardModelFrom,
	formatAgo,
	formatDuration,
	formatTokens,
} from "@plot/control/dashboard-model";
import {
	type AgentAttemptProjection,
	type DashboardProjection,
	type WorkItemProjection,
	workLabel,
} from "@plot/control/projection";
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

type WorkSurface = {
	readonly item: WorkItemProjection;
	readonly attempt?: AgentAttemptProjection | undefined;
};

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
	const model = dashboardModelFrom(projection);
	const counts = projectionReadyDoneCounts(projection);
	const samples = projection.tokenSamples;
	const tps = useMemo(() => {
		const last = samples[samples.length - 1];
		return last === undefined ? [] : throughputSeries(samples, last.atMs);
	}, [samples]);
	const work = [...projection.work.values()]
		.filter((item) => item.status !== "done")
		.map(
			(item): WorkSurface => ({
				item,
				attempt:
					item.currentRunId === undefined
						? undefined
						: projection.attempts.get(item.currentRunId),
			}),
		)
		.toSorted(
			(a, b) =>
				Number(needsAttention(b)) - Number(needsAttention(a)) ||
				(a.attempt?.startedAtSeq ?? 0) - (b.attempt?.startedAtSeq ?? 0),
		);
	const needs = work.filter(needsAttention);
	const agentsActive = session?.agents.active ?? model.pulse.runningCount;
	const agentsMax = session?.agents.max ?? model.pulse.maxConcurrentRuns;

	return (
		<div className="mt-3 flex flex-col">
			{/* status bar — the one always-dense strip */}
			<div className="sticky top-0 z-20 flex h-12 items-center border-b border-border bg-background px-6">
				<span className="mr-2 size-1.5 shrink-0 rounded-full bg-live" />
				<h1 className="text-sm font-medium tracking-[-0.01em]">
					{projection.workflowName}
				</h1>
				<span className={cn("ml-2 text-2xs text-t3", mono)}>
					<span className="capitalize">
						{session?.state ?? projection.status}
					</span>
					{projection.runtime.model ? ` · ${projection.runtime.model}` : ""}
				</span>
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
							<>
								ready {counts.ready} · done {counts.done}
							</>,
						]}
					</Divided>
				</div>
			</div>

			{session?.cwd ? (
				<div className="px-6 pt-4">
					<InputCopy value={session.cwd} variant="icon" className="max-w-xl" />
				</div>
			) : null}

			<div className="px-6 pt-3">
				<SessionControls session={session} projection={projection} />
			</div>

			{needs.length > 0 ? (
				<NeedsYouBand needs={needs} sessionId={projection.sessionId} />
			) : null}

			<div className="px-6 pt-6 pb-2 text-2xs text-t3">
				work · {work.length}
			</div>
			{work.length === 0 ? (
				<p className="border-t border-border px-6 py-4 text-2xs text-t3">
					No active work.
				</p>
			) : (
				work.map((item) => (
					<WorkLane
						key={item.item.workKey}
						work={item}
						sessionId={projection.sessionId}
					/>
				))
			)}

			<DoneSection projection={projection} />
			<RetrySection projection={projection} />
		</div>
	);
}

const needsAttention = (work: WorkSurface) =>
	work.item.status === "blocked" || work.item.status === "failed";

function statusToneText(work: WorkSurface): string {
	if (work.item.status === "blocked") return "text-attention";
	if (work.item.status === "failed") return "text-destructive";
	if (work.attempt?.streaming) return "text-live";
	return "text-t3";
}

function WorkLane({
	work,
	sessionId,
}: {
	work: WorkSurface;
	sessionId: string;
}) {
	const { item, attempt } = work;
	const [open, setOpen] = useState(
		(attempt?.streaming ?? false) || needsAttention(work),
	);
	const age =
		attempt?.startedAtMs === undefined
			? "n/a"
			: formatDuration(Date.now() - attempt.startedAtMs);
	const tokens =
		attempt?.tokens?.total === undefined
			? undefined
			: formatTokens(attempt.tokens.total);
	const activity =
		item.status === "blocked" && item.blockedReason !== undefined
			? item.blockedReason
			: attempt === undefined
				? item.status
				: attempt.streaming
					? (attempt.streams.tool ??
						attempt.streams.message ??
						(attempt.streams.thinking === undefined
							? attempt.activity
							: `Thinking · ${attempt.streams.thinking}`))
					: attempt.activity;
	const railTone =
		item.status === "blocked"
			? "bg-attention"
			: item.status === "failed"
				? "bg-destructive"
				: attempt?.streaming
					? "bg-live"
					: "bg-border";

	return (
		<div
			className={cn(
				"group border-t border-border",
				attempt?.streaming && "bg-live/5",
			)}
		>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="grid w-full grid-cols-[3px_1fr_auto_16px] items-center gap-x-4 px-6 py-4 text-left transition-colors hover:bg-hover"
			>
				<span className={cn("h-6 w-[3px] rounded-[3px]", railTone)} />
				<div className="min-w-0">
					<div className="flex items-baseline gap-2">
						<span className="weight-hover truncate text-sm">
							{workLabel(item)}
						</span>
						<span className={cn("shrink-0 text-2xs text-t3", mono)}>
							{item.workKey}
						</span>
					</div>
					<p
						className={cn(
							"mt-1 truncate text-2xs",
							mono,
							attempt?.streaming ? "shimmer-text" : "text-t3",
						)}
					>
						{activity}
					</p>
				</div>
				<div className="flex items-baseline gap-4 justify-self-end whitespace-nowrap">
					<span
						className={cn(
							"flex items-baseline text-2xs text-t3 opacity-0 transition-opacity group-hover:opacity-100",
							open && "opacity-100",
							mono,
						)}
					>
						<Divided>
							{[
								<>
									t
									<b className="font-normal text-muted-foreground">
										{attempt?.turnCount ?? 0}
									</b>
								</>,
								<b className="font-normal text-muted-foreground">
									{tokens ?? "—"}
								</b>,
								<CheckBadge attempt={attempt} />,
								<>{age}</>,
								<span>{attempt?.runId ?? "—"}</span>,
							]}
						</Divided>
					</span>
					<span className={cn("text-2xs", statusToneText(work))}>
						{item.status}
					</span>
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
					{attempt === undefined ? null : <LiveStreams attempt={attempt} />}
					{attempt !== undefined && attempt.phases.length > 0 ? (
						<Spine attempt={attempt} />
					) : null}
					{attempt === undefined ? null : (
						<div className="grid md:grid-cols-[1.5fr_1fr_1fr]">
							<Timeline attempt={attempt} />
							<Commands attempt={attempt} />
							<Observations attempt={attempt} />
						</div>
					)}
					<div className="mt-4 flex flex-wrap items-center gap-2">
						<OperatorActionButtons item={item} sessionId={sessionId} />
						{attempt === undefined ? null : (
							<InterruptRunButton
								item={item}
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

function CheckBadge({ attempt }: { attempt?: AgentAttemptProjection }) {
	if (attempt === undefined || attempt.check === "not-run") return null;
	if (attempt.check === "failed")
		return <span className="text-destructive">check failed</span>;
	if (attempt.check === "running")
		return <span className="text-live">check running</span>;
	return <span>passed</span>;
}

function LiveStreams({ attempt }: { attempt: AgentAttemptProjection }) {
	const rows = [
		...(attempt.streams.tool === undefined
			? []
			: [{ label: "tool", value: attempt.streams.tool }]),
		...(attempt.streams.message === undefined
			? []
			: [{ label: "message", value: attempt.streams.message }]),
		...(attempt.streams.thinking === undefined
			? []
			: [{ label: "thinking", value: attempt.streams.thinking }]),
	];
	if (rows.length === 0) return null;
	return (
		<div className={cn("mb-5 grid gap-1", mono)}>
			{rows.map((row) => (
				<div key={row.label} className="grid grid-cols-[72px_1fr] gap-3">
					<span className="text-t3">{row.label}</span>
					<span className="truncate text-muted-foreground">{row.value}</span>
				</div>
			))}
		</div>
	);
}

function Spine({ attempt }: { attempt: AgentAttemptProjection }) {
	const total =
		attempt.phases.reduce((sum, phase) => sum + phase.count, 0) || 1;
	return (
		<div className="mb-5">
			<div className="mb-2 flex h-1 gap-0.5">
				{attempt.phases.map((phase, index) => (
					<span
						key={`${phase.kind}-${phase.startedAtMs}`}
						className={cn(
							"rounded-full",
							index === attempt.phases.length - 1 && attempt.streaming
								? "bg-live"
								: "bg-border",
						)}
						style={{ flexGrow: Math.max(1, (phase.count / total) * 100) }}
					/>
				))}
			</div>
			<div
				className={cn("flex flex-wrap gap-x-3 gap-y-1 text-2xs text-t3", mono)}
			>
				{attempt.phases.map((phase) => (
					<span key={`label-${phase.kind}-${phase.startedAtMs}`}>
						{phase.kind} ·{phase.count}
					</span>
				))}
			</div>
		</div>
	);
}

function Col({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="border-l border-border px-6 first:border-l-0 first:pl-0">
			<div className={cn("mb-3 text-2xs text-t3", mono)}>{title}</div>
			{children}
		</div>
	);
}

function Timeline({ attempt }: { attempt: AgentAttemptProjection }) {
	const ordered = [...attempt.timeline].toSorted((a, b) => b.atMs - a.atMs);
	return (
		<Col
			title={`timeline · ${attempt.meaningfulCount} of ${attempt.eventCount} events`}
		>
			{ordered.length === 0 ? (
				<p className="text-2xs text-t3">No activity yet.</p>
			) : (
				<div className={mono}>
					{ordered.map((entry, index) => (
						<div
							key={`${entry.atMs}-${entry.text}`}
							className="grid grid-cols-[12px_1fr_auto] items-baseline gap-2 py-1"
						>
							<span
								className={cn(
									"size-1.5 justify-self-center self-center rounded-full",
									index === 0 && attempt.streaming
										? "bg-live ring-[3px] ring-live/20"
										: "bg-border",
								)}
							/>
							<span
								className={cn(
									"text-2xs",
									index === 0 && attempt.streaming
										? "text-foreground"
										: "text-muted-foreground",
								)}
							>
								{entry.text}
							</span>
							<span className="text-2xs text-t3">
								{formatAgo(Date.now() - entry.atMs)}
							</span>
						</div>
					))}
				</div>
			)}
		</Col>
	);
}

function Commands({ attempt }: { attempt: AgentAttemptProjection }) {
	if (attempt.commands.length === 0) return null;
	return (
		<Col title="commands">
			<div className={mono}>
				{attempt.commands.map((command, index) => (
					<div
						key={`${index}-${command}`}
						className="truncate py-1 text-2xs text-muted-foreground"
					>
						<span className={index === 0 ? "text-live" : "text-t3"}>$</span>{" "}
						{command}
					</div>
				))}
			</div>
		</Col>
	);
}

function Observations({ attempt }: { attempt: AgentAttemptProjection }) {
	if (attempt.observations.length === 0) return null;
	return (
		<Col title="observations">
			{attempt.observations.map((observation, index) => (
				<div
					key={`${index}-${observation}`}
					className="grid grid-cols-[12px_1fr] gap-2 py-1"
				>
					<span className="size-1.5 justify-self-center self-center rounded-full bg-t3" />
					<span className="text-2xs text-muted-foreground">{observation}</span>
				</div>
			))}
		</Col>
	);
}

function NeedsYouBand({
	needs,
	sessionId,
}: {
	needs: readonly WorkSurface[];
	sessionId: string;
}) {
	return (
		<div className="relative mt-6 border-y border-border bg-attention/5 px-6 py-4">
			<span className="absolute inset-y-0 left-0 w-0.5 bg-attention" />
			<div className="flex flex-col gap-3">
				{needs.map(({ item }) => (
					<div
						key={item.workKey}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						<div className="min-w-0">
							<p className="text-sm font-medium">
								{workLabel(item)}
								<span className={cn("ml-2 text-2xs text-t3", mono)}>
									{item.workKey}
								</span>
							</p>
							<p className="text-2xs text-muted-foreground">
								{item.blockedReason ?? item.status}
							</p>
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
		<div className="flex flex-wrap items-center justify-between gap-3 text-2xs">
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
				<span className="text-t3">{controllerBlockReason}</span>
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
		<>
			<div className="px-6 pt-6 pb-2 text-2xs text-t3">
				done · {projection.completed.length}
			</div>
			{projection.completed.slice(0, 8).map((entry) => (
				<div
					key={`${entry.workKey}-${entry.atMs}`}
					className="grid grid-cols-[3px_1fr_auto] items-center gap-x-4 border-t border-border px-6 py-3"
				>
					<span className="h-5 w-[3px] rounded-[3px] bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]" />
					<span className="truncate text-sm text-muted-foreground">
						{entry.label}
					</span>
					<span className={cn("shrink-0 text-2xs text-t3", mono)}>
						<span
							className={
								entry.status === "succeeded" ? "text-t3" : "text-destructive"
							}
						>
							{entry.status === "succeeded" ? entry.status : entry.message}
						</span>{" "}
						· {formatAgo(Date.now() - entry.atMs)}
					</span>
				</div>
			))}
		</>
	);
}

function RetrySection({ projection }: { projection: DashboardProjection }) {
	if (projection.scheduledWakes.length === 0) return null;
	return (
		<>
			<div className="px-6 pt-6 pb-2 text-2xs text-t3">retry</div>
			{projection.scheduledWakes.map((wake) => (
				<div
					key={`${wake.dueAtMs}-${wake.workKey ?? "session"}`}
					className="flex items-baseline justify-between gap-3 border-t border-border px-6 py-3"
				>
					<span className={cn("text-2xs text-muted-foreground", mono)}>
						↻ {wake.workKey ?? "session"}
					</span>
					<span className={cn("shrink-0 text-2xs text-t3", mono)}>
						attempt {wake.attempt ?? "n/a"} · in{" "}
						{formatDuration(wake.dueAtMs - Date.now())} · {wake.reason ?? "n/a"}
					</span>
				</div>
			))}
		</>
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
