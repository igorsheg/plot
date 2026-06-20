import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { InputCopy } from "@/components/ui/input-copy";
import { StatusDot } from "@/components/ui/status-indicator";
import { useShape } from "@/lib/shape-context";
import { cn } from "@/lib/utils";
import { useDashboardState } from "../dashboard-context";
import { stoppedSessionCount, visibleFleetSessions } from "../fleet-model";
import { Row, SectionLabel, Stack } from "./layout";
import { toneForSessionState } from "./status";

// Persistent fleet rail (master). Always visible on the left; selecting a
// session swaps only the detail pane.
export function FleetRail() {
	const { roster, selectedSessionId } = useDashboardState();
	const [showStopped, setShowStopped] = useState(false);
	const sessions = visibleFleetSessions(roster, showStopped);
	const stopped = stoppedSessionCount(roster);
	return (
		<nav className="flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border">
			<div className="flex items-center justify-between px-3 pt-4 pb-2">
				<SectionLabel>fleet</SectionLabel>
				<span className="font-mono text-2xs tabular-nums text-t3">
					{roster.length}
				</span>
			</div>
			<Stack gap={1} className="px-2 pb-3">
				{roster.length === 0 ? (
					<p className="px-2 py-1 font-mono text-2xs text-t3">No sessions.</p>
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
					<button
						type="button"
						onClick={() => setShowStopped((value) => !value)}
						className="mt-1 self-start px-2 py-1 font-mono text-2xs text-t3 transition-colors hover:text-foreground"
					>
						{showStopped ? "hide" : "show"} recently finished ({stopped})
					</button>
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
	const shape = useShape();
	return (
		<Link
			to="/session/$sessionId"
			params={{ sessionId: session.id }}
			search={(prev) => ({ role: prev.role ?? "controller" })}
			className={cn(
				"group flex flex-col gap-1 px-2 py-2 transition-colors",
				shape.item,
				active ? "bg-selected" : "hover:bg-hover",
			)}
		>
			<Row gap={2}>
				<StatusDot tone={toneForSessionState(session.state)} />
				<span
					className={cn(
						"min-w-0 flex-1 truncate text-sm transition-[font-variation-settings]",
						active && "font-medium",
					)}
				>
					{session.workflowName}
				</span>
				{session.needsYouCount > 0 ? (
					<Badge variant="solid" color="amber" size="sm">
						{session.needsYouCount}
					</Badge>
				) : null}
			</Row>
			<span className="truncate pl-4 font-mono text-2xs text-t3">
				{session.cwdName}
			</span>
		</Link>
	);
}

// The `/` detail pane: a connect/offline state when the roster is empty, else a
// prompt to pick a session from the rail.
export function OverviewPane() {
	const { roster } = useDashboardState();
	if (roster.length === 0) return <EmptyOrOffline />;
	return (
		<div className="flex flex-1 items-center justify-center py-24 text-sm text-t3">
			Select a session from the fleet.
		</div>
	);
}

function EmptyOrOffline() {
	const { connection, lastError } = useDashboardState();
	return (
		<div className="flex flex-1 items-center justify-center py-20">
			<Card className="max-w-lg">
				<Card.Header>
					<SectionLabel>
						{connection === "offline" ? "Offline" : "No Plot Sessions"}
					</SectionLabel>
				</Card.Header>
				<Card.Body>
					<Stack gap={3} className="text-sm text-t3">
						<p>
							{lastError ?? "Start a Plot Session, then refresh this page."}
						</p>
						<InputCopy value="plot --workflow WORKFLOW.md" />
						<InputCopy value="plot run --workflow WORKFLOW.md" />
					</Stack>
				</Card.Body>
			</Card>
		</div>
	);
}
