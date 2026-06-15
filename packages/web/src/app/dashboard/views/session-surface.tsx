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
import { Disclosure } from "@/components/ui/disclosure";
import { NotAvailable } from "@/components/ui/not-available";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
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
				subtitle={`${projection.runtime.cwdName || "n/a"} · ${session?.state ?? projection.status}`}
			>
				<div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
					<span className={tabular}>
						agents {session?.agents.active ?? model.pulse.runningCount}/
						{session?.agents.max ?? model.pulse.maxConcurrentRuns ?? "n/a"}
					</span>
					<span className={tabular}>
						{model.pulse.throughput.replace("tps", "tok/s")}
					</span>
					<span className={tabular}>tokens {model.pulse.totalTokens}</span>
					<span className={tabular}>
						ready {counts.ready} · done {counts.done}
					</span>
				</div>
			</PageHeader>
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
	return (
		<Card className="border border-attention/20">
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

// A work item as a stable process row, not a reflowing table cell. The volatile
// stream is isolated to one shimmering, truncating line (TextShimmer) so its
// length never moves the layout; actions live in their own row below it; the
// full event feed is an opt-in, auto-scrolling panel. Adapted from opencode's
// activity model onto our timeline-grained data.
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
		<div className="flex flex-col gap-1.5 px-4 py-3">
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-center gap-2">
					<WorkStageDot stage={work.stage} />
					<span className="truncate text-sm font-medium">
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
			{/* Live head: the one volatile line, isolated + truncated. */}
			<TextShimmer
				text={work.activity || "idle"}
				active={isLive}
				className="text-sm"
			/>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<OperatorActionButtons item={work} sessionId={sessionId} />
					<InterruptRunButton item={work} sessionId={sessionId} />
				</div>
				<ActivityFeed entries={work.timeline} />
			</div>
		</div>
	);
}

function ActivityFeed({
	entries,
}: {
	entries: RunningWorkProjection["timeline"];
}) {
	const ordered = [...entries].toSorted((a, b) => a.atMs - b.atMs);
	const scrollRef = useAutoScroll<HTMLDivElement>(ordered.length);
	if (ordered.length === 0) return null;
	return (
		<Disclosure>
			<Disclosure.Trigger className="gap-1 py-0 text-xs">
				<span>feed ({ordered.length})</span>
			</Disclosure.Trigger>
			<Disclosure.Panel>
				<div
					ref={scrollRef}
					className="mt-2 max-h-64 overflow-y-auto border-l border-border pl-3 font-mono text-xs"
				>
					<div className="flex flex-col gap-1">
						{ordered.map((entry) => (
							<div key={`${entry.atMs}-${entry.text}`} className="flex gap-2">
								<span className="shrink-0 tabular-nums text-muted-foreground">
									{formatAgo(Date.now() - entry.atMs)}
								</span>
								<span className="text-foreground">{entry.text}</span>
							</div>
						))}
					</div>
				</div>
			</Disclosure.Panel>
		</Disclosure>
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
