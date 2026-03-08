import { useCallback, useMemo, useState } from "react";
import { DateTime } from "effect";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { useDashboard } from "./root";
import { statusLabel, statusVariant } from "./status";
import { PhaseLabel } from "./phase-label";
import { TraceViewer } from "./trace-viewer";
import { timeAgo as sharedTimeAgo } from "@plot/sdk";
import { useIssueDetail, useRuntimeState } from "@/lib/hooks";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetDescription,
	SheetHeader,
	SheetPanel,
	SheetPopup,
	SheetTitle,
} from "@/components/ui/sheet";

const EMPTY_EVENTS: ReadonlyArray<AgentRuntimeEvent> = [];

function formatTimeAgo(dt: DateTime.Utc | string): string {
	if (typeof dt === "string") return sharedTimeAgo(new Date(dt).getTime());
	return sharedTimeAgo(DateTime.toEpochMillis(dt));
}

export function WorkDetailSheet() {
	const {
		state: { focusedIssueId },
		actions,
	} = useDashboard();
	const { data: snapshot } = useRuntimeState();
	const entry = useMemo(
		() =>
			focusedIssueId
				? snapshot?.running.find(
						(runningEntry) => runningEntry.issueId === focusedIssueId,
					)
				: undefined,
		[focusedIssueId, snapshot?.running],
	);

	const open = !!entry;
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) actions.focusIssue(null);
		},
		[actions],
	);
	const { data: detail } = useIssueDetail(entry?.issueIdentifier ?? "");
	const eventTail = detail?.eventTail ?? EMPTY_EVENTS;
	const lastMessage =
		detail?.running?.session.lastMessage ?? entry?.session.lastMessage;
	const lastUpdated = entry?.session.lastEventAt
		? formatTimeAgo(entry.session.lastEventAt)
		: null;

	const [selectedEventIndex, setSelectedEventIndex] = useState<number | null>(
		null,
	);
	const selectedEvent =
		selectedEventIndex !== null ? eventTail[selectedEventIndex] : null;

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
									{statusLabel(entry.state)}
								</Badge>
								<PhaseLabel events={eventTail} />
							</div>
							<SheetDescription className="type-meta">
								{lastUpdated
									? `last update ${lastUpdated}`
									: "waiting for first update"}
							</SheetDescription>
						</SheetHeader>
						<SheetPanel className="pt-0">
							<div className="section-shell">
								<TraceViewer
									events={eventTail}
									selectedEventIndex={selectedEventIndex}
									onSelectEvent={setSelectedEventIndex}
								/>

								{selectedEvent ? (
									<div className="section-shell">
										<p className="type-meta">event detail</p>
										<div className="inset-shell space-y-2">
											<div className="flex items-center gap-2">
												<Badge variant="outline" size="sm">
													{selectedEvent.event}
												</Badge>
												{selectedEvent.sessionId && (
													<span className="type-meta font-mono">
														{selectedEvent.sessionId}
													</span>
												)}
											</div>
											{selectedEvent.message && (
												<div className="text-sm text-foreground">
													<Streamdown mode="static">
														{selectedEvent.message}
													</Streamdown>
												</div>
											)}
											{selectedEvent.usage && (
												<div className="type-meta font-mono">
													{selectedEvent.usage.inputTokens}in /{" "}
													{selectedEvent.usage.outputTokens}out
												</div>
											)}
										</div>
									</div>
								) : lastMessage ? (
									<div className="section-shell">
										<p className="type-meta">latest output</p>
										<div className="inset-shell">
											<Streamdown mode="static">{lastMessage}</Streamdown>
										</div>
									</div>
								) : (
									<p className="type-body text-muted-foreground">
										no output yet
									</p>
								)}
							</div>
						</SheetPanel>
					</>
				) : null}
			</SheetPopup>
		</Sheet>
	);
}
