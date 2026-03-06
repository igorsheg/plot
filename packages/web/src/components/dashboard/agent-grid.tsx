import { DateTime } from "effect";
import { AnimatePresence } from "motion/react";
import { useDashboard } from "./root";
import { AgentCard } from "./agent-card";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

export function AgentGrid() {
  const {
    state: { snapshot, focusedIssueId, highlightedIssueId },
  } = useDashboard();

  const running = snapshot.running;
  const activeId = focusedIssueId ?? highlightedIssueId;
  const activeEntry = running.find((e) => e.issueId === activeId);

  const others = running
    .filter((e) => e.issueId !== activeId)
    .sort((a, b) => {
      const aAt = a.session.lastEventAt ? Number(DateTime.toEpochMillis(a.session.lastEventAt)) : 0;
      const bAt = b.session.lastEventAt ? Number(DateTime.toEpochMillis(b.session.lastEventAt)) : 0;
      return bAt - aAt;
    });

  if (running.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No active agents</EmptyTitle>
          <EmptyDescription>Agents will appear here when issues are dispatched</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">Agents</h2>
      <div className="border-t border-border">
        <AnimatePresence mode="popLayout">
          {activeEntry && <AgentCard key={activeEntry.issueId} entry={activeEntry} isExpanded />}
          {others.map((entry) => (
            <AgentCard key={entry.issueId} entry={entry} isExpanded={false} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
