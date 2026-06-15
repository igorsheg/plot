import {
	dashboardModelFrom,
	formatAgo,
	formatDuration,
	formatTokens,
} from "@plot/control/dashboard-model";
import {
	type DashboardProjection,
	type RunningWorkProjection,
	workLabel,
} from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { InputCopy } from "@/components/ui/input-copy";
import { NotAvailable } from "@/components/ui/not-available";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import {
	ThinkingStep,
	ThinkingSteps,
	ThinkingStepsContent,
	ThinkingStepsHeader,
} from "@/components/ui/thinking-steps";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
	useDashboardActions,
	useDashboardMeta,
	useDashboardState,
} from "../dashboard-context";
import { projectionReadyDoneCounts } from "../fleet-model";
import { OperatorActionButtons, InterruptRunButton } from "./operator-actions";
import { toneForStage, WorkStageDot } from "./status";

const tabular = "font-mono tabular-nums";
const muted = "text-muted-foreground";

export function SessionSurface() {
	const { roster, selectedSessionId, projection, lastError } =
		useDashboardState();
	const session = roster.find(
		(candidate) => candidate.id === selectedSessionId,
	);
	if (session === undefined && projection === undefined)
		return <SnapshotUnavailable lastError={lastError} />;

	return (
		<div className="flex flex-col gap-6">
			<Link
				to="/"
				search={(prev) => ({ role: prev.role ?? "controller" })}
				className="inline-flex items-center gap-2 self-start text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft size={14} /> all sessions
			</Link>
			{projection === undefined ? (
				<SnapshotUnavailable lastError={lastError} />
			) : (
				<ProcessTable projection={projection} session={session} />
			)}
		</div>
	);
}

function ProcessTable({
	projection,
	session,
}: {
	projection: DashboardProjection;
	session?: PlotSessionSummary;
}) {
	const model = dashboardModelFrom(projection);
	const counts = projectionReadyDoneCounts(projection);
	const work = [...projection.running.values()].toSorted(
		(a, b) => a.startedAtSeq - b.startedAtSeq,
	);
	return (
		<>
			<PageHeader
				title={projection.workflowName}
				subtitle={session?.state ?? projection.status}
			>
				<div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
					<Tooltip content="Active / max concurrent agents">
						<span className={tabular}>
							agents {session?.agents.active ?? model.pulse.runningCount}/
							{session?.agents.max ?? model.pulse.maxConcurrentRuns ?? "n/a"}
						</span>
					</Tooltip>
					<Tooltip content="Token throughput">
						<span className={tabular}>
							{model.pulse.throughput.replace("tps", "tok/s")}
						</span>
					</Tooltip>
					<Tooltip content="Total tokens this session">
						<span className={tabular}>tokens {model.pulse.totalTokens}</span>
					</Tooltip>
					<Tooltip content="Work items ready to run · completed">
						<span className={tabular}>
							ready {counts.ready} · done {counts.done}
						</span>
					</Tooltip>
				</div>
			</PageHeader>
			{session?.cwd ? (
				<InputCopy value={session.cwd} variant="icon" className="max-w-xl" />
			) : null}
			<SessionControls session={session} projection={projection} />
			<NeedsYouZone work={work} sessionId={projection.sessionId} />
			<Card>
				<Card.Header>
					<SectionLabel>work</SectionLabel>
				</Card.Header>
				<Card.Body className="p-0">
					{work.length === 0 ? (
						<p className={cn("px-4 py-3 text-sm", muted)}>No active work.</p>
					) : (
						<div className="flex flex-col divide-y divide-border">
							{work.map((item) => (
								<WorkItem
									key={item.workKey}
									work={item}
									sessionId={projection.sessionId}
								/>
							))}
						</div>
					)}
				</Card.Body>
			</Card>
			<RetrySection projection={projection} />
		</>
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
		<Card>
			<Card.Body className="flex flex-wrap items-center justify-between gap-3 text-xs">
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
						variant="tertiary"
						className="border-destructive/40 text-destructive"
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
									Active Agent Runs will be interrupted; Session History is
									kept.
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
			</Card.Body>
		</Card>
	);
}

function NeedsYouZone({
	work,
	sessionId,
}: {
	work: readonly RunningWorkProjection[];
	sessionId: string;
}) {
	const needs = work.filter(
		(item) =>
			item.stage === "blocked" || (item.operatorActions?.length ?? 0) > 0,
	);
	if (needs.length === 0) return null;
	// Lift the attention zone a couple steps up the surface ladder so it reads as
	// more prominent than the surrounding panels (elevation, not just a border).
	return (
		<Card offset={4} className="border border-attention/20">
			<Card.Header>
				<SectionLabel className="text-attention">needs you</SectionLabel>
			</Card.Header>
			<Card.Body className="flex flex-col gap-3">
				{needs.map((item) => (
					<div
						key={item.workKey}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						<div>
							<p className="text-sm font-medium">{workLabel(item)}</p>
							<p className="text-xs text-muted-foreground">
								{item.lastMeaningful}
							</p>
						</div>
						<OperatorActionButtons
							item={item}
							sessionId={sessionId}
							prominent
						/>
					</div>
				))}
			</Card.Body>
		</Card>
	);
}

// A work item as a stable process row. The volatile stream is isolated to one
// line that uses FF's `shimmer-text` while the agent is live (motion, not
// reflow, signals "working"); the event history is an opt-in FF ThinkingSteps
// timeline — each entry a step on a connecting line, the current one `active`.
function WorkItem({
	work,
	sessionId,
}: {
	work: RunningWorkProjection;
	sessionId: string;
}) {
	const isLive = toneForStage(work.stage) === "active";
	const age =
		work.startedAtMs === undefined
			? "n/a"
			: formatDuration(Date.now() - work.startedAtMs);
	const tokens =
		work.tokens?.total === undefined
			? undefined
			: formatTokens(work.tokens.total);
	return (
		<div className="group flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-hover">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<WorkStageDot stage={work.stage} />
					<span className="weight-hover truncate text-sm">
						{workLabel(work)}
					</span>
					<span className="truncate font-mono text-xs text-muted-foreground">
						{work.workKey}
					</span>
				</div>
				<div className={cn("flex shrink-0 items-center gap-3", tabular, muted)}>
					<span>{work.stage}</span>
					<span>
						{age} · #{Math.max(1, work.turnCount || 1)}
					</span>
					<span>{tokens ?? <NotAvailable />}</span>
					<span>{work.runId || <NotAvailable />}</span>
				</div>
			</div>
			{/* Live line: FF shimmer-text while working, static muted otherwise. */}
			<p
				className={cn(
					"truncate text-sm",
					isLive ? "shimmer-text" : "text-muted-foreground",
				)}
			>
				{work.activity || "idle"}
			</p>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<OperatorActionButtons item={work} sessionId={sessionId} />
					<InterruptRunButton item={work} sessionId={sessionId} />
				</div>
				<WorkFeed entries={work.timeline} isLive={isLive} />
			</div>
		</div>
	);
}

function WorkFeed({
	entries,
	isLive,
}: {
	entries: RunningWorkProjection["timeline"];
	isLive: boolean;
}) {
	const ordered = [...entries].toSorted((a, b) => a.atMs - b.atMs);
	if (ordered.length === 0) return null;
	const lastIndex = ordered.length - 1;
	return (
		<ThinkingSteps defaultOpen={false} className="w-full">
			<ThinkingStepsHeader className="text-xs">
				feed ({ordered.length})
			</ThinkingStepsHeader>
			<ThinkingStepsContent>
				{ordered.map((entry, index) => (
					<ThinkingStep
						key={`${entry.atMs}-${entry.text}`}
						index={index}
						icon="dot"
						label={entry.text}
						description={formatAgo(Date.now() - entry.atMs)}
						status={index === lastIndex && isLive ? "active" : "complete"}
						isLast={index === lastIndex}
					/>
				))}
			</ThinkingStepsContent>
		</ThinkingSteps>
	);
}

function RetrySection({ projection }: { projection: DashboardProjection }) {
	return (
		<Card>
			<Card.Header>
				<SectionLabel>retry</SectionLabel>
			</Card.Header>
			<Card.Body className="flex flex-col gap-2 text-xs">
				{projection.scheduledWakes.length === 0 ? (
					<p className={muted}>No queued retries.</p>
				) : (
					projection.scheduledWakes.map((wake) => (
						<div
							key={`${wake.dueAtMs}-${wake.workKey ?? "session"}`}
							className="flex justify-between gap-3"
						>
							<span className="font-mono">↻ {wake.workKey ?? "session"}</span>
							<span className={cn(tabular, muted)}>
								attempt {wake.attempt ?? "n/a"} · in{" "}
								{formatDuration(wake.dueAtMs - Date.now())} ·{" "}
								{wake.reason ?? "n/a"}
							</span>
						</div>
					))
				)}
			</Card.Body>
		</Card>
	);
}

function SnapshotUnavailable({
	lastError,
}: {
	lastError?: string | undefined;
}) {
	return (
		<Card>
			<Card.Body className="space-y-2 text-sm text-muted-foreground">
				<p>Snapshot unavailable for this Plot Session.</p>
				{lastError ? <p>{lastError}</p> : null}
			</Card.Body>
		</Card>
	);
}
