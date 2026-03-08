import { useCallback, useMemo } from "react";
import { DateTime } from "effect";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { useDashboard } from "./root";
import { PhaseLabel } from "./phase-label";
import { statusLabel, statusVariant } from "./status";
import { timeAgo as sharedTimeAgo } from "@plot/sdk";
import { useIssueDetail, useRuntimeState } from "@/lib/hooks";
import { useStickToBottom } from "@/hooks/use-stick-to-bottom";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetDescription,
	SheetHeader,
	SheetPanel,
	SheetPopup,
	SheetTitle,
} from "@/components/ui/sheet";

function formatTimeAgo(dt: DateTime.Utc | string): string {
	if (typeof dt === "string") return sharedTimeAgo(new Date(dt).getTime());
	return sharedTimeAgo(DateTime.toEpochMillis(dt));
}

function formatEventTime(dt: DateTime.Utc): string {
	const d = new Date(Number(DateTime.toEpochMillis(dt)));
	return d.toLocaleTimeString(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function EventRow({ event }: { event: AgentRuntimeEvent }) {
	return (
		<div className="flex items-start gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0">
			<span className="shrink-0 font-mono text-muted-foreground">
				{formatEventTime(event.timestamp)}
			</span>
			<span className="text-foreground">{event.event}</span>
			{event.message ? (
				<span className="min-w-0 truncate text-muted-foreground">
					{event.message}
				</span>
			) : null}
		</div>
	);
}

function EventTail({ events }: { events: ReadonlyArray<AgentRuntimeEvent> }) {
	const { ref, isAtBottom, scrollToBottom } = useStickToBottom<HTMLDivElement>();

	return (
		<div className="section-shell">
			<div className="flex items-center justify-between">
				<p className="type-meta">event trace</p>
				{!isAtBottom && (
					<button
						type="button"
						className="text-xs text-muted-foreground hover:text-foreground"
						onClick={scrollToBottom}
					>
						scroll to bottom
					</button>
				)}
			</div>
			<div ref={ref} className="inset-shell max-h-64 overflow-y-auto">
				{events.length > 0 ? (
					events.map((event) => (
						<EventRow
							key={`${event.issueId}-${event.event}-${Number(DateTime.toEpochMillis(event.timestamp))}`}
							event={event}
						/>
					))
				) : (
					<p className="px-3 py-2 text-xs text-muted-foreground">
						no events yet
					</p>
				)}
			</div>
		</div>
	);
}

export function WorkDetailSheet() {
	const {
		state: { focusedIssueId },
		actions,
	} = useDashboard();
	const { data: snapshot } = useRuntimeState();
	const entry = focusedIssueId
		? snapshot?.running.find(
				(runningEntry) => runningEntry.issueId === focusedIssueId,
			)
		: undefined;

	const open = !!entry;
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) actions.focusIssue(null);
		},
		[actions],
	);
	const { data: detail } = useIssueDetail(entry?.issueIdentifier ?? "");
	const lastMessage =
		detail?.running?.session.lastMessage ?? entry?.session.lastMessage;
	const lastUpdated = entry?.session.lastEventAt
		? formatTimeAgo(entry.session.lastEventAt)
		: null;
	const events = useMemo(() => detail?.eventTail ?? [], [detail?.eventTail]);

	return (
		<Sheet onOpenChange={handleOpenChange} open={open}>
			<SheetPopup side="right" variant="inset">
				{entry ? (
					<>
						<SheetHeader className="section-shell pr-12">
							<div className="cluster-shell">
								<SheetTitle className="type-title">
									{entry.issueIdentifier}
								</SheetTitle>
								<Badge variant={statusVariant(entry.state)} size="sm">
									<PhaseLabel label={statusLabel(entry.state)} />
								</Badge>
							</div>
							<SheetDescription className="type-meta">
								{lastUpdated
									? `last update ${lastUpdated}`
									: "waiting for first update"}
							</SheetDescription>
						</SheetHeader>
						<SheetPanel className="pt-0">
							<div className="section-shell">
								<p className="type-meta">latest output</p>
								{lastMessage ? (
									<div className="inset-shell">
										<Streamdown mode="static">{lastMessage}</Streamdown>
									</div>
								) : (
									<p className="type-body text-muted-foreground">
										no output yet
									</p>
								)}
							</div>
							<EventTail events={events} />
						</SheetPanel>
					</>
				) : null}
			</SheetPopup>
		</Sheet>
	);
}
