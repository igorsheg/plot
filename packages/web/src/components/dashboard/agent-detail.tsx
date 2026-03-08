import { useCallback } from "react";
import { DateTime } from "effect";

import { useDashboard } from "./root";
import { statusLabel, statusVariant } from "./status";
import { timeAgo as sharedTimeAgo, formatTokens } from "@plot/sdk";
import { useRuntimeSnapshot } from "@/lib/runtime";
import { useEventLog } from "@/lib/use-event-log";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@/components/ui/sheet";
import { TraceViewer } from "@/components/trace-viewer";

function formatTimeAgo(dt: DateTime.Utc | string): string {
  if (typeof dt === "string") return sharedTimeAgo(new Date(dt).getTime());
  return sharedTimeAgo(DateTime.toEpochMillis(dt));
}

export function WorkDetailSheet() {
  const {
    state: { focusedIssueId },
    actions,
  } = useDashboard();
  const snapshot = useRuntimeSnapshot();
  const entry = focusedIssueId
    ? snapshot?.running.find((runningEntry) => runningEntry.issueId === focusedIssueId)
    : undefined;

  const open = !!entry;
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) actions.focusIssue(null);
    },
    [actions],
  );

  const session = entry?.session;
  const lastUpdated = session?.lastEventAt ? formatTimeAgo(session.lastEventAt) : null;
  const identifier = entry?.issueIdentifier ?? "";
  const { events, isLoading: logLoading } = useEventLog(open ? identifier : "");

  return (
    <Sheet onOpenChange={handleOpenChange} open={open}>
      <SheetPopup side="right" variant="inset">
        {entry && session ? (
          <>
            <SheetHeader className="section-shell pr-12">
              <div className="cluster-shell">
                <SheetTitle className="type-title">{entry.issueIdentifier}</SheetTitle>
                <Badge variant={statusVariant(entry.state)} size="sm">
                  {statusLabel(entry.state)}
                </Badge>
              </div>
              <SheetDescription className="type-meta">
                {lastUpdated ? `last update ${lastUpdated}` : "waiting for first update"}
                {" · "}turn {session.turnCount} · {formatTokens(session.totalTokens)} tokens
              </SheetDescription>
            </SheetHeader>
            <SheetPanel className="flex flex-1 flex-col overflow-hidden pt-0">
              <TraceViewer.Root
                events={events}
                issueId={entry.issueId}
                issueIdentifier={entry.issueIdentifier}
                isLoading={logLoading}
              >
                <TraceViewer.Toolbar />
                <TraceViewer.EventList />
                <TraceViewer.DetailPane />
              </TraceViewer.Root>
            </SheetPanel>
          </>
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}
