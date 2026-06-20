import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardPanel } from "@/components/ui/card";
import { InputCopy } from "@/components/ui/input-copy";
import { StatusDot } from "@/components/ui/status-indicator";
import { cn } from "@/lib/utils";
import { useDashboardState } from "../dashboard-context";
import { stoppedSessionCount, visibleFleetSessions } from "../fleet-model";
import { Meta, MetaButton, Row, SectionLabel, Stack } from "./layout";
import { sessionIsRunning, toneForSession } from "./status";

// The left chrome — the single navigation column. It owns the brand, the
// connection state (am I linked to plot?), and the fleet (the session list).
// There is no top bar and no per-session back link: switching sessions happens
// here, so the room never repeats this affordance.

// ponytail: connection states map to a dot tone + label. The two attention
// states (offline, handoff-missing) share the amber tone.
const connectionDot: Record<
	"online" | "connecting" | "offline" | "handoff-missing",
	{ tone: "online" | "muted" | "attention"; label: string }
> = {
	online: { tone: "online", label: "online" },
	connecting: { tone: "muted", label: "connecting" },
	offline: { tone: "attention", label: "offline · last frame" },
	"handoff-missing": { tone: "attention", label: "handoff needed" },
};

function ConnectionBadge() {
	const { connection } = useDashboardState();
	const dot = connectionDot[connection] ?? connectionDot.offline;
	return (
		<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
			<StatusDot tone={dot.tone} />
			{dot.label}
		</span>
	);
}

export function FleetRail() {
	const { roster, selectedSessionId } = useDashboardState();
	const [showStopped, setShowStopped] = useState(false);
	const sessions = visibleFleetSessions(roster, showStopped);
	const stopped = stoppedSessionCount(roster);
	return (
		<nav className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border">
			{/* brand + connection — the global strip, folded into the rail header */}
			<div className="flex items-center justify-between px-3 pt-4 pb-3">
				<Link
					to="/"
					search={(prev) => ({ role: prev.role ?? "controller" })}
					className="text-sm font-medium text-foreground"
				>
					plot
				</Link>
				<ConnectionBadge />
			</div>
			<div className="flex items-center justify-between border-t border-border px-3 pt-3 pb-2">
				<SectionLabel>fleet</SectionLabel>
				<Meta>{roster.length}</Meta>
			</div>
			<Stack gap={1} className="px-2 pb-3">
				{roster.length === 0 ? (
					<Meta className="block px-2 py-1">No sessions.</Meta>
				) : (
					sessions.map((session) => (
						<FleetRailItem
							key={session.id}
							session={session}
							active={session.id === selectedSessionId}
						/>
					))
				)}
				{stopped > 0 ? (
					<MetaButton
						onClick={() => setShowStopped((value) => !value)}
						className="mt-1 self-start px-2 py-1"
					>
						{showStopped ? "hide" : "show"} recently finished ({stopped})
					</MetaButton>
				) : null}
			</Stack>
		</nav>
	);
}

function FleetRailItem({
	session,
	active,
}: {
	session: PlotSessionSummary;
	active: boolean;
}) {
	const running = sessionIsRunning(session);
	const needsYou = session.needsYouCount > 0;
	return (
		<Link
			to="/session/$sessionId"
			params={{ sessionId: session.id }}
			search={(prev) => ({ role: prev.role ?? "controller" })}
			className={cn(
				"group flex flex-col gap-1 rounded-md px-2 py-2 transition-colors",
				active ? "bg-selected" : "hover:bg-hover",
			)}
		>
			<Row gap={2}>
				<StatusDot tone={toneForSession(session)} />
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm transition-colors",
						active && "font-medium",
						!running && !needsYou && "text-muted-foreground",
					)}
				>
					{session.workflowName}
				</span>
				{needsYou ? (
					<Badge variant="warning" size="sm">
						{session.needsYouCount}
					</Badge>
				) : running ? (
					<Meta tone="live">
						{session.agents.active}
						{session.agents.max > 0 ? `/${session.agents.max}` : ""}
					</Meta>
				) : null}
			</Row>
			<Meta tone={running ? "default" : "muted"} className="truncate pl-4">
				{session.cwdName}
			</Meta>
		</Link>
	);
}

// The `/` pane: only the empty/offline state. With the fleet always in the
// rail, there is no "pick a session" prompt — landing online with a roster
// dives into the top session; landing with nothing shows how to start one.
export function OverviewPane() {
	return <EmptyOrOffline />;
}

function EmptyOrOffline() {
	const { roster, connection, lastError } = useDashboardState();
	if (roster.length > 0) return null;
	return (
		<div className="flex flex-1 items-center justify-center py-20">
			<Card className="max-w-lg">
				<CardHeader>
					<SectionLabel>
						{connection === "offline" ? "Offline" : "No Plot Sessions"}
					</SectionLabel>
				</CardHeader>
				<CardPanel>
					<Stack gap={3} className="text-sm text-t3">
						<p>
							{lastError ?? "Start a Plot Session, then refresh this page."}
						</p>
						<InputCopy value="plot --workflow WORKFLOW.md" />
						<InputCopy value="plot run --workflow WORKFLOW.md" />
					</Stack>
				</CardPanel>
			</Card>
		</div>
	);
}
