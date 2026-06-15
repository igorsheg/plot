import {
	dashboardModelFrom,
	formatAgo,
	formatDuration,
	formatTokens,
} from "@plot/control/dashboard-model";
import {
	workLabel,
	type DashboardProjection,
	type RunningWorkProjection,
} from "@plot/control/projection";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
	projectionReadyDoneCounts,
	sortPlotSessions,
	stoppedSessionCount,
	visibleFleetSessions,
} from "./fleet-model";
import {
	surfaceForState,
	usePlotWebDashboardState,
	type PlotWebDashboardState,
} from "./web-dashboard-state";

const accent = "text-amber-600 dark:text-amber-500";
const muted = "text-muted-foreground";
const tabular = "tabular-nums";

export function DashboardPage({ state }: { state?: PlotWebDashboardState }) {
	const liveState = usePlotWebDashboardState();
	const dashboardState = state ?? liveState;
	const surface = surfaceForState(dashboardState);
	return (
		<main className="min-h-dvh bg-background text-foreground">
			<div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 pb-12 md:px-8">
				<TopBar state={dashboardState} />
				{surface === "session" ? (
					<SessionSurface state={dashboardState} />
				) : (
					<FleetSurface state={dashboardState} />
				)}
			</div>
		</main>
	);
}

function TopBar({ state }: { state: PlotWebDashboardState }) {
	return (
		<div className="flex items-center justify-between gap-4 py-5 text-[12px] text-muted-foreground">
			<a href="?view=fleet" className="font-medium text-foreground">
				plot
			</a>
			<div className="flex items-center gap-3">
				<ConnectionBadge state={state} />
				<span className="hidden md:inline">
					{state.roster.length === 1
						? "1 Plot Session"
						: `${state.roster.length} Plot Sessions`}
				</span>
			</div>
		</div>
	);
}

function ConnectionBadge({ state }: { state: PlotWebDashboardState }) {
	if (state.connection === "online")
		return (
			<Badge variant="dot" color="green" size="sm">
				online
			</Badge>
		);
	if (state.connection === "connecting")
		return (
			<Badge variant="dot" color="gray" size="sm">
				connecting
			</Badge>
		);
	return (
		<Badge variant="dot" color="amber" size="sm">
			{state.connection === "offline"
				? "offline · last frame"
				: "handoff needed"}
		</Badge>
	);
}

function FleetSurface({ state }: { state: PlotWebDashboardState }) {
	const [showStopped, setShowStopped] = useState(false);
	const sessions = visibleFleetSessions(state.roster, showStopped);
	const stopped = stoppedSessionCount(state.roster);
	if (state.roster.length === 0) return <EmptyOrOffline state={state} />;
	return (
		<div className="flex flex-col gap-6 py-8">
			<Header
				title="your plots"
				subtitle="Fleet view over Local Plot Server roster summaries."
			/>
			<Card>
				<Card.Body className="p-0">
					<Table>
						<Table.Element>
							<Table.Head>
								<Table.Row className="border-b border-border">
									<Table.HeaderCell>Workflow</Table.HeaderCell>
									<Table.HeaderCell>Project</Table.HeaderCell>
									<Table.HeaderCell>Session State</Table.HeaderCell>
									<Table.HeaderCell>Agents</Table.HeaderCell>
									<Table.HeaderCell>Needs You</Table.HeaderCell>
									<Table.HeaderCell>tokens/s</Table.HeaderCell>
									<Table.HeaderCell>Activity</Table.HeaderCell>
									<Table.HeaderCell>Attachments</Table.HeaderCell>
								</Table.Row>
							</Table.Head>
							<Table.Body>
								{sessions.map((session) => (
									<FleetRow key={session.id} session={session} />
								))}
							</Table.Body>
						</Table.Element>
					</Table>
				</Card.Body>
			</Card>
			{stopped > 0 ? (
				<button
					type="button"
					className="self-start text-[12px] text-muted-foreground hover:text-foreground"
					onClick={() => setShowStopped((value) => !value)}
				>
					{showStopped ? "hide" : "show"} recently finished ({stopped})
				</button>
			) : null}
		</div>
	);
}

function FleetRow({ session }: { session: PlotSessionSummary }) {
	return (
		<Table.Row className="transition-colors hover:bg-hover">
			<Table.Cell>
				<a
					href={`?session=${encodeURIComponent(session.id)}`}
					className="block"
				>
					<span className="font-medium">{session.workflowName}</span>
					<span className="mt-1 block max-w-56 truncate text-muted-foreground">
						{session.workflowPath}
					</span>
				</a>
			</Table.Cell>
			<Table.Cell>
				<span>{session.cwdName}</span>
				<span className="mt-1 block max-w-52 truncate text-muted-foreground">
					{session.cwd}
				</span>
			</Table.Cell>
			<Table.Cell>
				<SessionState state={session.state} />
			</Table.Cell>
			<Table.Cell className={tabular}>
				{session.agents.active}/{session.agents.max}
			</Table.Cell>
			<Table.Cell className={cn(tabular, session.needsYouCount > 0 && accent)}>
				{session.needsYouCount}
			</Table.Cell>
			<Table.Cell className={tabular}>
				{session.tokenThroughputPerSecond === null ? (
					<NA />
				) : (
					`${formatTokens(Math.round(session.tokenThroughputPerSecond))} tok/s`
				)}
			</Table.Cell>
			<Table.Cell className={tabular}>
				{session.lastActivityAt === null ? (
					<NA />
				) : (
					formatAgo(Date.now() - Date.parse(session.lastActivityAt))
				)}
			</Table.Cell>
			<Table.Cell className={cn(tabular, muted)}>
				{session.attachments.observers} obs · {session.attachments.controllers}{" "}
				ctl
			</Table.Cell>
		</Table.Row>
	);
}

function SessionSurface({ state }: { state: PlotWebDashboardState }) {
	const session = state.roster.find(
		(candidate) => candidate.id === state.selectedSessionId,
	);
	const projection = state.projection;
	if (session === undefined && projection === undefined)
		return <EmptyOrOffline state={state} />;
	return (
		<div className="flex flex-col gap-6 py-8">
			<a
				href="?view=fleet"
				className="inline-flex items-center gap-2 self-start text-[12px] text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft size={14} /> all sessions
			</a>
			{projection === undefined ? (
				<SnapshotUnavailable state={state} />
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
			<Header
				title={projection.workflowName}
				subtitle={`${projection.runtime.cwdName || "n/a"} · ${session?.state ?? projection.status}`}
			>
				<div className="flex flex-wrap items-center gap-4 text-[12px] text-muted-foreground">
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
			</Header>
			<NeedsYouZone work={work} />
			<Card>
				<Card.Header>
					<SectionTitle>work</SectionTitle>
				</Card.Header>
				<Card.Body className="p-0">
					<Table>
						<Table.Element>
							<Table.Head>
								<Table.Row className="border-b border-border">
									<Table.HeaderCell></Table.HeaderCell>
									<Table.HeaderCell>Work Item</Table.HeaderCell>
									<Table.HeaderCell>Stage</Table.HeaderCell>
									<Table.HeaderCell>Age / attempt</Table.HeaderCell>
									<Table.HeaderCell>Tokens</Table.HeaderCell>
									<Table.HeaderCell>Agent Run</Table.HeaderCell>
									<Table.HeaderCell>Event / activity</Table.HeaderCell>
								</Table.Row>
							</Table.Head>
							<Table.Body>
								{work.length === 0 ? (
									<Table.Row>
										<Table.Cell colSpan={7} className={muted}>
											No active work.
										</Table.Cell>
									</Table.Row>
								) : (
									work.map((item) => <WorkRow key={item.workKey} work={item} />)
								)}
							</Table.Body>
						</Table.Element>
					</Table>
				</Card.Body>
			</Card>
			<RetrySection projection={projection} />
		</>
	);
}

function NeedsYouZone({ work }: { work: readonly RunningWorkProjection[] }) {
	const needs = work.filter(
		(item) =>
			item.stage === "blocked" || (item.operatorActions?.length ?? 0) > 0,
	);
	if (needs.length === 0) return null;
	return (
		<Card className="border border-amber-500/20">
			<Card.Header>
				<SectionTitle className={accent}>needs you</SectionTitle>
			</Card.Header>
			<Card.Body className="flex flex-col gap-3">
				{needs.map((item) => (
					<div
						key={item.workKey}
						className="flex flex-wrap items-center justify-between gap-3"
					>
						<div>
							<p className="text-[13px] font-medium">{workLabel(item)}</p>
							<p className="text-[12px] text-muted-foreground">
								{item.lastMeaningful}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							{(item.operatorActions ?? []).length === 0 ? (
								<Button size="sm" disabled>
									Operator action pending
								</Button>
							) : (
								item.operatorActions?.map((action) => (
									<Button
										key={action.id}
										size="sm"
										disabled
										title={
											action.disabledReason ?? "Phase 8 wires final controls"
										}
									>
										{action.label}
									</Button>
								))
							)}
						</div>
					</div>
				))}
			</Card.Body>
		</Card>
	);
}

function WorkRow({ work }: { work: RunningWorkProjection }) {
	const age =
		work.startedAtMs === undefined
			? "n/a"
			: formatDuration(Date.now() - work.startedAtMs);
	const tokens =
		work.tokens?.total === undefined
			? undefined
			: formatTokens(work.tokens.total);
	return (
		<Table.Row>
			<Table.Cell>
				<StatusDot stage={work.stage} />
			</Table.Cell>
			<Table.Cell>
				<div className="font-medium">{workLabel(work)}</div>
				<div className="max-w-72 truncate text-muted-foreground">
					{work.workKey}
				</div>
			</Table.Cell>
			<Table.Cell>{work.stage}</Table.Cell>
			<Table.Cell className={tabular}>
				{age} / #{Math.max(1, work.turnCount || 1)}
			</Table.Cell>
			<Table.Cell className={tabular}>{tokens ?? <NA />}</Table.Cell>
			<Table.Cell className={tabular}>{work.runId || <NA />}</Table.Cell>
			<Table.Cell>
				<div className="max-w-xl text-foreground">
					{work.activity || <NA />}
				</div>
				<Timeline entries={work.timeline} />
			</Table.Cell>
		</Table.Row>
	);
}

function Timeline({ entries }: { entries: RunningWorkProjection["timeline"] }) {
	if (entries.length === 0) return null;
	return (
		<Disclosure>
			<Disclosure.Trigger className="mt-2 justify-start gap-1 py-0 text-[12px]">
				<span>timeline ({entries.length})</span>
			</Disclosure.Trigger>
			<Disclosure.Panel>
				<div className="mt-2 flex flex-col gap-1 border-l border-border pl-3 text-[12px] text-muted-foreground">
					{entries.map((entry) => (
						<div key={`${entry.atMs}-${entry.text}`}>
							<span className={tabular}>
								{formatAgo(Date.now() - entry.atMs)}
							</span>{" "}
							· {entry.text}
						</div>
					))}
				</div>
			</Disclosure.Panel>
		</Disclosure>
	);
}

function RetrySection({ projection }: { projection: DashboardProjection }) {
	return (
		<Card>
			<Card.Header>
				<SectionTitle>retry</SectionTitle>
			</Card.Header>
			<Card.Body className="flex flex-col gap-2 text-[12px]">
				{projection.scheduledWakes.length === 0 ? (
					<p className={muted}>No queued retries.</p>
				) : (
					projection.scheduledWakes.map((wake) => (
						<div
							key={`${wake.dueAtMs}-${wake.workKey ?? "session"}`}
							className="flex justify-between gap-3"
						>
							<span>↻ {wake.workKey ?? "session"}</span>
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

function EmptyOrOffline({ state }: { state: PlotWebDashboardState }) {
	return (
		<div className="flex flex-1 items-center justify-center py-20">
			<Card className="max-w-lg">
				<Card.Header>
					<SectionTitle>
						{state.connection === "offline" ? "Offline" : "No Plot Sessions"}
					</SectionTitle>
				</Card.Header>
				<Card.Body className="space-y-3 text-[13px] text-muted-foreground">
					<p>
						{state.lastError ?? "Start a Plot Session, then refresh this page."}
					</p>
					<CodeLine>plot tui --workflow WORKFLOW.md</CodeLine>
					<CodeLine>plot run --workflow WORKFLOW.md</CodeLine>
				</Card.Body>
			</Card>
		</div>
	);
}

function SnapshotUnavailable({ state }: { state: PlotWebDashboardState }) {
	return (
		<Card>
			<Card.Body className="space-y-2 text-[13px] text-muted-foreground">
				<p>Snapshot unavailable for this Plot Session.</p>
				{state.lastError ? <p>{state.lastError}</p> : null}
			</Card.Body>
		</Card>
	);
}

function Header({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle: string;
	children?: ReactNode;
}) {
	return (
		<header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
			<div>
				<h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
				<p className="mt-1 text-[13px] text-muted-foreground">{subtitle}</p>
			</div>
			{children}
		</header>
	);
}

function SectionTitle({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<h2
			className={cn("text-[12px] font-medium text-muted-foreground", className)}
		>
			{children}
		</h2>
	);
}

function SessionState({ state }: { state: PlotSessionSummary["state"] }) {
	return (
		<span className="inline-flex items-center gap-2">
			<StatusDot
				stage={
					state === "error"
						? "failed"
						: state === "paused"
							? "blocked"
							: "working"
				}
			/>
			{state}
		</span>
	);
}

function StatusDot({ stage }: { stage: string }) {
	const tone =
		stage === "blocked"
			? "bg-amber-500"
			: stage === "failed"
				? "bg-destructive"
				: stage === "completed"
					? "bg-muted-foreground"
					: "bg-foreground";
	return (
		<span
			className={cn("inline-block size-2 rounded-full", tone)}
			aria-hidden
		/>
	);
}

function NA() {
	return <span className="text-muted-foreground">n/a</span>;
}

function CodeLine({ children }: { children: ReactNode }) {
	return (
		<code className="block rounded-md bg-muted px-3 py-2 font-mono text-[12px] text-foreground">
			{children}
		</code>
	);
}

export { sortPlotSessions };
