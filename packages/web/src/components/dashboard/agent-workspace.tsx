import { useDashboard } from "./root";
import { useRuntimeSnapshot } from "@/lib/runtime";
import { useEventLog } from "@/lib/use-event-log";
import { TraceViewer } from "@/components/trace-viewer";

export function AgentWorkspace() {
	const {
		state: { focusedIssueId },
	} = useDashboard();
	const snapshot = useRuntimeSnapshot();
	const entry = focusedIssueId
		? snapshot?.running.find(
				(runningEntry) => runningEntry.issueId === focusedIssueId,
			)
		: undefined;

	const identifier = entry?.issueIdentifier ?? "";
	const { events, isLoading } = useEventLog(entry ? identifier : "");

	if (!entry) {
		return (
			<div className="agent-workspace flex items-center justify-center">
				<span className="type-meta">
					select an issue to inspect
				</span>
			</div>
		);
	}

	return (
		<div className="agent-workspace">
			<TraceViewer.Root
				events={events}
				issueId={entry.issueId}
				issueIdentifier={entry.issueIdentifier}
				isLoading={isLoading}
			>
				<div className="trace-split">
					<div className="trace-event-pane">
						<TraceViewer.Toolbar />
						<TraceViewer.EventList />
					</div>
					<div className="trace-detail-pane">
						<TraceViewer.DetailPane />
					</div>
				</div>
			</TraceViewer.Root>
		</div>
	);
}
