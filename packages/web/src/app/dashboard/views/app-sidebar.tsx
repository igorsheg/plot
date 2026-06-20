import type { PlotSessionSummary } from "@plot/control/session-summary";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
} from "@/components/ui/sidebar";
import { StatusDot } from "@/components/ui/status-indicator";
import { cn } from "@/lib/utils";
import { useDashboardMeta, useDashboardState } from "../dashboard-context";
import { stoppedSessionCount, visibleFleetSessions } from "../fleet-model";
import { Meta, MetaButton, Row, SectionLabel } from "./layout";
import { sessionIsRunning, toneForSession } from "./status";

// The web shell's left chrome, built on the coss Sidebar primitive (Base UI +
// Tailwind). `collapsible="offcanvas"`: the fleet is persistent in-flow when
// open and slides away to give the room full bleed when collapsed (via the
// rail); on mobile it is a sheet. Modelled on the shadcn sidebar-07 shell, but
// the room stays minimal — no inset header, the pulse header owns the title.

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

export function AppSidebar() {
	const { roster, selectedSessionId } = useDashboardState();
	const { controlRole } = useDashboardMeta();
	const [showStopped, setShowStopped] = useState(false);
	const sessions = visibleFleetSessions(roster, showStopped);
	const stopped = stoppedSessionCount(roster);
	return (
		<Sidebar collapsible="offcanvas">
			<SidebarHeader>
				<div className="flex items-center justify-between px-2 py-2">
					<Link
						to="/"
						search={(prev) => ({ role: prev.role ?? "controller" })}
						className="text-sm font-medium text-foreground"
					>
						plot
					</Link>
					<ConnectionBadge />
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>
						<SectionLabel count={roster.length}>fleet</SectionLabel>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{roster.length === 0 ? (
								<Meta className="block px-2 py-1">No sessions.</Meta>
							) : (
								sessions.map((session) => (
									<FleetSessionItem
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
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<Row gap={2} className="px-2 py-2">
					<StatusDot tone={controlRole === "controller" ? "online" : "muted"} />
					<Meta tone="muted" className="capitalize">
						{controlRole}
					</Meta>
				</Row>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}

function FleetSessionItem({
	session,
	active,
}: {
	session: PlotSessionSummary;
	active: boolean;
}) {
	const running = sessionIsRunning(session);
	const needsYou = session.needsYouCount > 0;
	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				isActive={active}
				className="h-auto py-2"
				render={
					<Link
						to="/session/$sessionId"
						params={{ sessionId: session.id }}
						search={(prev) => ({ role: prev.role ?? "controller" })}
					/>
				}
			>
				<Row gap={2}>
					<StatusDot tone={toneForSession(session)} />
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-sm transition-colors",
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
				<Meta tone={running ? "default" : "muted"} className="truncate pl-6">
					{session.cwdName}
				</Meta>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}
