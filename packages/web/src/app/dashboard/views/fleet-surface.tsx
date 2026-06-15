import { formatAgo, formatTokens } from "@plot/control/dashboard-model";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { InputCopy } from "@/components/ui/input-copy";
import { NotAvailable } from "@/components/ui/not-available";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { cn } from "@/lib/utils";
import { useDashboardState } from "../dashboard-context";
import { stoppedSessionCount, visibleFleetSessions } from "../fleet-model";
import { SessionStateIndicator } from "./status";

const tabular = "font-mono tabular-nums";

export function FleetSurface() {
	const { roster, connection, lastError } = useDashboardState();
	const [showStopped, setShowStopped] = useState(false);
	if (roster.length === 0)
		return <EmptyOrOffline connection={connection} lastError={lastError} />;

	const sessions = visibleFleetSessions(roster, showStopped);
	const stopped = stoppedSessionCount(roster);

	return (
		<div className="flex flex-col gap-6 py-8">
			<PageHeader
				title="your plots"
				subtitle="Fleet view over Local Plot Server roster summaries."
			>
				{stopped > 0 ? (
					<TabsSubtle
						selectedIndex={showStopped ? 1 : 0}
						onSelect={(index) => setShowStopped(index === 1)}
					>
						<TabsSubtleItem index={0} label="Active" />
						<TabsSubtleItem index={1} label={`All (${roster.length})`} />
					</TabsSubtle>
				) : null}
			</PageHeader>
			<Card>
				<Card.Body className="p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Workflow</TableHead>
								<TableHead>Project</TableHead>
								<TableHead>Session State</TableHead>
								<TableHead>Agents</TableHead>
								<TableHead>Needs You</TableHead>
								<TableHead>tokens/s</TableHead>
								<TableHead>Activity</TableHead>
								<TableHead>Attachments</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{sessions.map((session, index) => (
								<FleetRow key={session.id} session={session} index={index} />
							))}
						</TableBody>
					</Table>
				</Card.Body>
			</Card>
		</div>
	);
}

function FleetRow({
	session,
	index,
}: {
	session: PlotSessionSummary;
	index: number;
}) {
	return (
		<TableRow index={index}>
			<TableCell>
				<a
					href={`?session=${encodeURIComponent(session.id)}`}
					className="block"
				>
					<span className="font-medium">{session.workflowName}</span>
					<span className="mt-1 block max-w-56 truncate font-mono text-muted-foreground">
						{session.workflowPath}
					</span>
				</a>
			</TableCell>
			<TableCell>
				<span>{session.cwdName}</span>
				<span className="mt-1 block max-w-52 truncate font-mono text-muted-foreground">
					{session.cwd}
				</span>
			</TableCell>
			<TableCell>
				<SessionStateIndicator state={session.state} />
			</TableCell>
			<TableCell className={tabular}>
				{session.agents.active}/{session.agents.max}
			</TableCell>
			<TableCell
				className={cn(tabular, session.needsYouCount > 0 && "text-attention")}
			>
				{session.needsYouCount}
			</TableCell>
			<TableCell className={tabular}>
				{session.tokenThroughputPerSecond === null ? (
					<NotAvailable />
				) : (
					`${formatTokens(Math.round(session.tokenThroughputPerSecond))} tok/s`
				)}
			</TableCell>
			<TableCell className={tabular}>
				{session.lastActivityAt === null ? (
					<NotAvailable />
				) : (
					formatAgo(Date.now() - Date.parse(session.lastActivityAt))
				)}
			</TableCell>
			<TableCell className={cn(tabular, "text-muted-foreground")}>
				{session.attachments.observers} obs · {session.attachments.controllers}{" "}
				ctl
			</TableCell>
		</TableRow>
	);
}

function EmptyOrOffline({
	connection,
	lastError,
}: {
	connection: string;
	lastError?: string | undefined;
}) {
	return (
		<div className="flex flex-1 items-center justify-center py-20">
			<Card className="max-w-lg">
				<Card.Header>
					<SectionLabel>
						{connection === "offline" ? "Offline" : "No Plot Sessions"}
					</SectionLabel>
				</Card.Header>
				<Card.Body className="flex flex-col gap-3 text-sm text-muted-foreground">
					<p>{lastError ?? "Start a Plot Session, then refresh this page."}</p>
					<InputCopy value="plot tui --workflow WORKFLOW.md" />
					<InputCopy value="plot run --workflow WORKFLOW.md" />
				</Card.Body>
			</Card>
		</div>
	);
}
