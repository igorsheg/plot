import { use, createContext, useMemo, useState, useCallback, type ReactNode } from "react";
import type { AgentRuntimeEvent } from "@plot/sdk";

export interface TraceViewerState {
  events: readonly AgentRuntimeEvent[];
  selectedEvent: AgentRuntimeEvent | null;
  query: string;
  typeFilter: Set<string>;
  isFollowingTail: boolean;
  viewMode: "grouped" | "raw";
}

export interface TraceViewerActions {
  setQuery: (q: string) => void;
  toggleTypeFilter: (type: string) => void;
  clearTypeFilter: () => void;
  selectEvent: (event: AgentRuntimeEvent | null) => void;
  toggleFollowTail: () => void;
  toggleViewMode: () => void;
}

export interface TraceViewerMeta {
  issueId: string;
  issueIdentifier: string;
  isLoading: boolean;
  total: number;
}

export interface TraceViewerContextValue {
  state: TraceViewerState;
  actions: TraceViewerActions;
  meta: TraceViewerMeta;
}

const TraceViewerContext = createContext<TraceViewerContextValue | null>(null);

export function useTraceViewer(): TraceViewerContextValue {
  const ctx = use(TraceViewerContext);
  if (!ctx) throw new Error("TraceViewer compound components must be used within TraceViewer.Root");
  return ctx;
}

interface RootProps {
  events: readonly AgentRuntimeEvent[];
  issueId: string;
  issueIdentifier: string;
  isLoading: boolean;
  children: ReactNode;
}

export function matchesQuery(event: AgentRuntimeEvent, q: string): boolean {
  const lower = q.toLowerCase();
  if (event.event.toLowerCase().includes(lower)) return true;
  if (event.message?.toLowerCase().includes(lower)) return true;
  if (event.toolName?.toLowerCase().includes(lower)) return true;
  return false;
}

export function Root({ events, issueId, issueIdentifier, isLoading, children }: RootProps) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<AgentRuntimeEvent | null>(null);
  const [isFollowingTail, setIsFollowingTail] = useState(true);
  const [viewMode, setViewMode] = useState<"grouped" | "raw">("grouped");

  const toggleTypeFilter = useCallback((type: string) => {
    setTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const clearTypeFilter = useCallback(() => {
    setTypeFilter(new Set());
  }, []);

  const toggleFollowTail = useCallback(() => {
    setIsFollowingTail((prev) => !prev);
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === "grouped" ? "raw" : "grouped"));
  }, []);

  const value = useMemo<TraceViewerContextValue>(
    () => ({
      state: {
        events,
        selectedEvent,
        query,
        typeFilter,
        isFollowingTail,
        viewMode,
      },
      actions: {
        setQuery,
        toggleTypeFilter,
        clearTypeFilter,
        selectEvent: setSelectedEvent,
        toggleFollowTail,
        toggleViewMode,
      },
      meta: {
        issueId,
        issueIdentifier,
        isLoading,
        total: events.length,
      },
    }),
    [
      events,
      selectedEvent,
      query,
      typeFilter,
      isFollowingTail,
      viewMode,
      issueId,
      issueIdentifier,
      isLoading,
      toggleTypeFilter,
      clearTypeFilter,
      toggleFollowTail,
      toggleViewMode,
    ],
  );

  return <TraceViewerContext value={value}>{children}</TraceViewerContext>;
}
