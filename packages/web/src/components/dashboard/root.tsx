import {
  use,
  createContext,
  useCallback,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { useRuntimeSnapshot } from "@/lib/runtime";

export interface DashboardState {
  focusedIssueId: string | null;
  opsOpen: boolean;
}

export interface DashboardActions {
  focusIssue: (id: string | null) => void;
  toggleOps: () => void;
}

export interface DashboardMeta {
  runningCount: number;
  retryingCount: number;
}

export interface DashboardContextValue {
  state: DashboardState;
  actions: DashboardActions;
  meta: DashboardMeta;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const ctx = use(DashboardContext);
  if (!ctx) throw new Error("Dashboard compound components must be used within Dashboard.Root");
  return ctx;
}

export function Root({ children }: { children: ReactNode }) {
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [opsOpen, setOpsOpen] = useState(false);
  const snapshot = useRuntimeSnapshot();
  const running = snapshot?.running ?? [];
  const retrying = snapshot?.retrying ?? [];

  const toggleOps = useCallback(() => setOpsOpen((prev) => !prev), []);

  useEffect(() => {
    if (running.length === 1 && !focusedIssueId) {
      setFocusedIssueId(running[0]?.issueId ?? null);
    }
    if (focusedIssueId && !running.some((e) => e.issueId === focusedIssueId)) {
      setFocusedIssueId(null);
    }
  }, [running, focusedIssueId]);

  const value = useMemo<DashboardContextValue>(
    () => ({
      state: { focusedIssueId, opsOpen },
      actions: { focusIssue: setFocusedIssueId, toggleOps },
      meta: {
        runningCount: running.length,
        retryingCount: retrying.length,
      },
    }),
    [focusedIssueId, opsOpen, toggleOps, running.length, retrying.length],
  );

  return <DashboardContext value={value}>{children}</DashboardContext>;
}
