import { motion, AnimatePresence } from "motion/react";
import * as React from "react";
import { Streamdown } from "streamdown";
import "streamdown/styles.css";
import { useDashboard } from "./root";
import { useIssueDetail } from "@/lib/hooks";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { statusLabel, statusVariant } from "./status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "@/components/ui/tooltip";
import { CopyIcon, CheckIcon, XIcon } from "lucide-react";

const transition = { duration: 0.2, ease: [0.32, 0.72, 0, 1] as const };
const motionInitial = { opacity: 0, y: 8 };
const motionAnimate = { opacity: 1, y: 0 };
const motionExit = { opacity: 0, y: -8 };
const loadingRows = ["loading-1", "loading-2", "loading-3"] as const;

function getEventKey(event: { event: string; message: string | null; timestamp: { toString: () => string } }) {
  return `${event.timestamp.toString()}-${event.event}-${event.message ?? ""}`;
}

function SessionId({ id }: { id: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard();
  const short = id.slice(0, 8);
  const handleClick = React.useCallback(() => {
    copyToClipboard(id);
  }, [copyToClipboard, id]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex cursor-pointer items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
          onClick={handleClick}
        >
          Session {short}
          {isCopied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </TooltipTrigger>
        <TooltipPopup>{isCopied ? "Copied" : "Copy session ID"}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AgentDetail() {
  const { state, actions, meta } = useDashboard();
  const { snapshot, focusedIssueId, highlightedIssueId } = state;
  const activeId = focusedIssueId ?? highlightedIssueId;
  const entry = activeId ? snapshot.running.find((r) => r.issueId === activeId) : undefined;
  const handleClose = React.useCallback(() => {
    actions.focusIssue(null);
  }, [actions]);

  const { data: detail, isLoading } = useIssueDetail(entry?.issueIdentifier ?? "");

  return (
    <AnimatePresence mode="wait">
      {entry && (
        <motion.div
          key={entry.issueId}
          initial={motionInitial}
          animate={motionAnimate}
          exit={motionExit}
          transition={transition}
        >
          <div className="space-y-4 border-b border-border py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{entry.issueIdentifier}</span>
                <Badge variant={statusVariant(entry.state)} size="sm">
                  {statusLabel(entry.state)}
                </Badge>
              </div>
              <Button variant="ghost" size="xs" onClick={handleClose}>
                <XIcon />
                Close
              </Button>
            </div>

            {entry.workspacePath && (
              <p className="font-mono text-xs text-muted-foreground/50">{entry.workspacePath}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <SessionId id={entry.session.sessionId} />
              <span>·</span>
              <span>{entry.session.turnCount} turns</span>
              <span>·</span>
              <span>
                In {meta.formatTokens(entry.session.inputTokens)} / Out{" "}
                {meta.formatTokens(entry.session.outputTokens)}
              </span>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs text-muted-foreground">Events</h3>
              <ScrollArea className="max-h-60">
                <div className="divide-y divide-border rounded-sm border border-border">
                  {isLoading
                    ? loadingRows.map((key) => (
                        <div key={key} className="flex items-center gap-3 px-3 py-2">
                          <Skeleton className="h-3 w-12" />
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-40" />
                        </div>
                      ))
                    : detail?.eventTail.map((evt) => (
                        <div key={getEventKey(evt)} className="flex items-center gap-3 px-3 py-2 text-xs">
                          <span className="shrink-0 text-muted-foreground/50">
                            {meta.timeAgo(evt.timestamp)}
                          </span>
                          <Badge variant="outline" size="sm">
                            {evt.event}
                          </Badge>
                          {evt.message && (
                            <span className="truncate text-muted-foreground">{evt.message}</span>
                          )}
                        </div>
                      ))}
                </div>
              </ScrollArea>
            </div>

            {detail?.running?.session.lastMessage && (
              <div className="space-y-2">
                <h3 className="text-xs text-muted-foreground">Last message</h3>
                <div className="rounded-sm border border-border p-3">
                  <Streamdown mode="static">{detail.running.session.lastMessage}</Streamdown>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
