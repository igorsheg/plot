import { motion } from "motion/react";
import * as React from "react";
import type { RunningEntry } from "@plot/shared";
import { useDashboard } from "./root";
import { statusLabel, statusVariant, isActiveState } from "./status";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
};

interface AgentCardProps {
  entry: RunningEntry;
  isExpanded: boolean;
}

export function AgentCard({ entry, isExpanded }: AgentCardProps) {
  const { actions, meta } = useDashboard();
  const { session } = entry;
  const active = isActiveState(entry.state);
  const handleClick = React.useCallback(() => {
    actions.focusIssue(entry.issueId);
  }, [actions, entry.issueId]);

  return (
    <motion.div
      layout="position"
      layoutId={entry.issueId}
      transition={springTransition}
      className={cn(
        "cursor-pointer border-b border-border px-1 py-3 transition-colors hover:bg-accent/50",
        active && "border-l-2 border-l-success/50 pl-3",
      )}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{entry.issueIdentifier}</span>
        <Badge variant={statusVariant(entry.state)} size="sm">
          {statusLabel(entry.state)}
        </Badge>
        {session.lastEventAt && (
          <span className="ml-auto text-xs text-muted-foreground">
            {meta.timeAgo(session.lastEventAt)}
          </span>
        )}
      </div>

      {session.lastMessage && (
        <p className={cn("mt-1 text-xs text-muted-foreground", !isExpanded && "truncate")}>
          {session.lastMessage}
        </p>
      )}

      <div className="mt-1 text-xs text-muted-foreground/50">
        {session.turnCount} turns · {meta.formatTokens(session.totalTokens)} tokens
      </div>

      {isExpanded && entry.workspacePath && (
        <p className="mt-1 text-xs text-muted-foreground/50">{entry.workspacePath}</p>
      )}
    </motion.div>
  );
}
