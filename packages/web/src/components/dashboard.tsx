import { use, createContext, useMemo, useState, type ReactNode } from "react";
import { DateTime } from "effect";
import type { RuntimeSnapshot } from "@plot/shared";
import { useRuntimeState, useIssueDetail, useTriggerRefresh } from "@/lib/hooks";
import { useEventStream } from "@/lib/use-event-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardPanel } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Frame } from "@/components/ui/frame";
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsiblePanel } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";

// --- context ---

/** Shared state for all Dashboard compound components. */
interface DashboardState {
  snapshot: RuntimeSnapshot;
  selectedIssueId: string | null;
  sseStatus: "connected" | "connecting" | "disconnected";
}

/** Actions available to Dashboard compound components. */
interface DashboardActions {
  selectIssue: (id: string | null) => void;
  triggerRefresh: () => void;
}

/** Formatting utilities passed through context. */
interface DashboardMeta {
  formatTokens: (n: number) => string;
  formatDuration: (seconds: number) => string;
  timeAgo: (dt: DateTime.Utc | string) => string;
}

/** Combined context value for Dashboard compound components. */
interface DashboardContextValue {
  state: DashboardState;
  actions: DashboardActions;
  meta: DashboardMeta;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

function useDashboard(): DashboardContextValue {
  const ctx = use(DashboardContext);
  if (!ctx) throw new Error("Dashboard compound components must be used within Dashboard.Root");
  return ctx;
}

// --- formatting ---

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function toEpochMs(dt: DateTime.Utc | string): number {
  if (typeof dt === "string") return new Date(dt).getTime();
  return DateTime.toEpochMillis(dt);
}

function timeAgo(dt: DateTime.Utc | string): string {
  const diff = (Date.now() - toEpochMs(dt)) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  return `${Math.round(diff / 3600)}h ago`;
}

const meta = { formatTokens, formatDuration, timeAgo } as const;

// --- skeleton ---

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-8">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="mt-2 h-3 w-32" />
      </div>
      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-3 w-16" />
            </CardHeader>
            <CardPanel>
              <Skeleton className="h-7 w-20" />
            </CardPanel>
          </Card>
        ))}
      </div>
      <div className="mb-3">
        <Skeleton className="h-3 w-28" />
      </div>
      <Frame>
        <div className="p-1">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex gap-4 px-2.5 py-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="ml-auto h-3 w-8" />
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </Frame>
    </div>
  );
}

// --- compound components ---

function Root({ children }: { children: ReactNode }) {
  const {
    data: snapshot,
    isLoading,
    isError,
    error,
  } = useRuntimeState({ refetchInterval: 10_000 });

  const { status: sseStatus } = useEventStream();

  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const refresh = useTriggerRefresh();

  const value = useMemo(
    () =>
      snapshot
        ? {
            state: { snapshot, selectedIssueId, sseStatus },
            actions: {
              selectIssue: setSelectedIssueId,
              triggerRefresh: () => refresh.mutate(),
            },
            meta,
          }
        : null,
    [snapshot, selectedIssueId, sseStatus, refresh],
  );

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">{String(error)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Retrying...</p>
        </div>
      </div>
    );
  }

  if (isLoading || !value) {
    return <DashboardSkeleton />;
  }

  return (
    <DashboardContext value={value}>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </DashboardContext>
  );
}

function Header() {
  const {
    state: { snapshot, sseStatus },
    actions,
  } = useDashboard();
  const hasRunning = snapshot.counts.running > 0;

  const getStatusDotClass = () => {
    switch (sseStatus) {
      case "connected":
        return "bg-emerald-500";
      case "connecting":
        return "bg-amber-500";
      case "disconnected":
        return "bg-red-500";
      default:
        return "bg-gray-400";
    }
  };

  const getStatusText = () => {
    switch (sseStatus) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
      default:
        return "Unknown";
    }
  };

  return (
    <header className="mb-8 flex items-center justify-between">
      <div>
        <h1 className="text-sm font-semibold tracking-tight">plot</h1>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {hasRunning && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
          )}
          {snapshot.counts.running} running · {snapshot.counts.retrying} retrying
          <span className="text-muted-foreground/60">
            · up {formatDuration(snapshot.codexTotals.secondsRunning)}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <span className={`inline-flex h-1.5 w-1.5 rounded-full ${getStatusDotClass()}`} />
              </TooltipTrigger>
              <TooltipPopup>{getStatusText()}</TooltipPopup>
            </Tooltip>
          </TooltipProvider>
        </p>
      </div>
      <Button variant="ghost" size="xs" onClick={() => actions.triggerRefresh()}>
        Refresh
      </Button>
    </header>
  );
}

function Metrics() {
  const {
    state: { snapshot },
    meta: m,
  } = useDashboard();

  return (
    <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium text-muted-foreground">Sessions</CardTitle>
        </CardHeader>
        <CardPanel>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">
            {snapshot.counts.running}
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium text-muted-foreground">Tokens</CardTitle>
        </CardHeader>
        <CardPanel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="cursor-default">
                <div className="text-3xl font-semibold tabular-nums tracking-tight">
                  {m.formatTokens(snapshot.codexTotals.totalTokens)}
                </div>
              </TooltipTrigger>
              <TooltipPopup>
                In {m.formatTokens(snapshot.codexTotals.inputTokens)} / Out{" "}
                {m.formatTokens(snapshot.codexTotals.outputTokens)}
              </TooltipPopup>
            </Tooltip>
          </TooltipProvider>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium text-muted-foreground">Runtime</CardTitle>
        </CardHeader>
        <CardPanel>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">
            {m.formatDuration(snapshot.codexTotals.secondsRunning)}
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xs font-medium text-muted-foreground">Retries</CardTitle>
        </CardHeader>
        <CardPanel>
          <div className="text-3xl font-semibold tabular-nums tracking-tight">
            {snapshot.counts.retrying}
          </div>
        </CardPanel>
      </Card>
    </div>
  );
}

function Sessions() {
  const {
    state: { snapshot, selectedIssueId },
    actions,
    meta: m,
  } = useDashboard();

  function handleRowClick(issueId: string) {
    actions.selectIssue(selectedIssueId === issueId ? null : issueId);
  }

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Active Sessions</h2>
      {snapshot.running.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No active sessions</EmptyTitle>
            <EmptyDescription>
              Sessions will appear here when issues are dispatched
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Frame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Issue</TableHead>
                <TableHead className="text-xs">State</TableHead>
                <TableHead className="text-xs">Message</TableHead>
                <TableHead className="text-right text-xs">Turns</TableHead>
                <TableHead className="text-right text-xs">Tokens</TableHead>
                <TableHead className="text-right text-xs">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.running.map((entry) => (
                <TableRow
                  key={entry.issueId}
                  className={`cursor-pointer transition-colors hover:bg-muted/50 ${
                    selectedIssueId === entry.issueId ? "bg-muted/70" : ""
                  }`}
                  onClick={() => handleRowClick(entry.issueId)}
                >
                  <TableCell className="font-mono text-xs font-medium">
                    {entry.issueIdentifier}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" size="sm">
                      {entry.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {entry.session.lastMessage ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {entry.session.turnCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    <span>{m.formatTokens(entry.session.totalTokens)}</span>
                    <span className="block text-xs text-muted-foreground/60">
                      In {m.formatTokens(entry.session.inputTokens)} / Out{" "}
                      {m.formatTokens(entry.session.outputTokens)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {m.timeAgo(entry.startedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Frame>
      )}
    </section>
  );
}

function Detail() {
  const {
    state: { snapshot, selectedIssueId },
    actions,
    meta: m,
  } = useDashboard();

  const selectedEntry = selectedIssueId
    ? snapshot.running.find((e) => e.issueId === selectedIssueId)
    : null;

  const identifier = selectedEntry?.issueIdentifier ?? "";

  const { data: detail, isLoading } = useIssueDetail(identifier);

  const isOpen = selectedIssueId !== null && selectedEntry !== null;

  return (
    <Collapsible open={isOpen}>
      <CollapsiblePanel>
        <section className="mb-8">
          <Frame>
            <div className="p-4">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{identifier}</span>
                  {selectedEntry && (
                    <Badge variant="outline" size="sm">
                      {selectedEntry.state}
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="xs" onClick={() => actions.selectIssue(null)}>
                  Close
                </Button>
              </div>

              {isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              )}

              {detail && (
                <div className="space-y-4">
                  {detail.workspacePath && (
                    <p className="font-mono text-xs text-muted-foreground">
                      {detail.workspacePath}
                    </p>
                  )}

                  {detail.running && (
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        Session
                        <button
                          type="button"
                          className="cursor-pointer font-mono text-foreground/70 transition-colors hover:text-foreground"
                          onClick={() =>
                            navigator.clipboard.writeText(detail.running!.session.sessionId)
                          }
                        >
                          {detail.running.session.sessionId.slice(0, 8)}…
                        </button>
                      </span>
                      <span>Turns {detail.running.session.turnCount}</span>
                      <span>
                        In {m.formatTokens(detail.running.session.inputTokens)} / Out{" "}
                        {m.formatTokens(detail.running.session.outputTokens)}
                      </span>
                    </div>
                  )}

                  <div>
                    <h3 className="mb-2 text-xs font-medium text-muted-foreground">Events</h3>
                    <ScrollArea className="max-h-80">
                      {detail.eventTail.length === 0 ? (
                        <p className="py-2 text-xs text-muted-foreground/60">connecting...</p>
                      ) : (
                        <div className="space-y-1">
                          {detail.eventTail.map((evt, i) => (
                            <div key={i} className="flex items-baseline gap-2 text-xs">
                              <span className="shrink-0 text-muted-foreground/60">
                                {m.timeAgo(evt.timestamp)}
                              </span>
                              <Badge variant="outline" size="sm">
                                {evt.event}
                              </Badge>
                              {evt.message && (
                                <span className="truncate text-muted-foreground">
                                  {evt.message}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ScrollArea>
                  </div>
                </div>
              )}
            </div>
          </Frame>
        </section>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function RetryQueue() {
  const {
    state: { snapshot },
    meta: m,
  } = useDashboard();

  if (snapshot.retrying.length === 0) return null;

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Retry Queue</h2>
      <Frame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Issue</TableHead>
              <TableHead className="text-right text-xs">Attempt</TableHead>
              <TableHead className="text-xs">Error</TableHead>
              <TableHead className="text-right text-xs">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshot.retrying.map((retry) => (
              <TableRow key={retry.issueId}>
                <TableCell className="font-mono text-xs font-medium">{retry.identifier}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="warning" size="sm">
                    {retry.attempt}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-xs truncate text-muted-foreground">
                  {retry.error ?? "—"}
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {m.timeAgo(retry.dueAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Frame>
    </section>
  );
}

export const Dashboard = {
  Root,
  Header,
  Metrics,
  Sessions,
  Detail,
  RetryQueue,
};
