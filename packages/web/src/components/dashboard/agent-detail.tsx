import { useCallback } from "react";
import { DateTime } from "effect";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useDashboard } from "./root";
import { statusLabel, statusVariant } from "./status";
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

function formatTimeAgo(dt: DateTime.Utc | string): string {
	if (typeof dt === "string") return sharedTimeAgo(new Date(dt).getTime());
	return sharedTimeAgo(DateTime.toEpochMillis(dt));
}

export function AgentDetail() {
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
						</SheetPanel>
					</>
				) : null}
			</SheetPopup>
		</Sheet>
	);
}
