import {
	use,
	createContext,
	useMemo,
	useState,
	useRef,
	useEffect,
	type ReactNode,
} from "react";
import { DateTime } from "effect";
import {
	formatTokens,
	formatDuration,
	timeAgo as sharedTimeAgo,
	type RuntimeSnapshot,
	type SseStatus,
} from "@plot/shared";
import { useRuntimeState, useTriggerRefresh } from "@/lib/hooks";
import { useEventStream } from "@/lib/use-event-stream";
import { Skeleton } from "@/components/ui/skeleton";

export interface DashboardState {
	snapshot: RuntimeSnapshot;
	highlightedIssueId: string | null;
	focusedIssueId: string | null;
	sseStatus: SseStatus;
}

export interface DashboardActions {
	focusIssue: (id: string | null) => void;
	triggerRefresh: () => void;
}

export interface DashboardMeta {
	formatTokens: (n: number) => string;
	formatDuration: (seconds: number) => string;
	timeAgo: (dt: DateTime.Utc | string) => string;
}

export interface DashboardContextValue {
	state: DashboardState;
	actions: DashboardActions;
	meta: DashboardMeta;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
	const ctx = use(DashboardContext);
	if (!ctx)
		throw new Error(
			"Dashboard compound components must be used within Dashboard.Root",
		);
	return ctx;
}

function toEpochMs(dt: DateTime.Utc | string): number {
	if (typeof dt === "string") return new Date(dt).getTime();
	return DateTime.toEpochMillis(dt);
}

function timeAgo(dt: DateTime.Utc | string): string {
	return sharedTimeAgo(toEpochMs(dt));
}

const meta = { formatTokens, formatDuration, timeAgo } as const;

function computeHighlightedId(snapshot: RuntimeSnapshot): string | null {
	let best: { id: string; at: number } | null = null;
	for (const entry of snapshot.running) {
		const lastAt = entry.session.lastEventAt;
		if (!lastAt) continue;
		const ms = toEpochMs(lastAt);
		if (!best || ms > best.at) {
			best = { id: entry.issueId, at: ms };
		}
	}
	return best?.id ?? null;
}

const DEBOUNCE_MS = 1500;

function useAutoHighlight(
	snapshot: RuntimeSnapshot | undefined,
): string | null {
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const latestRef = useRef<string | null>(null);

	useEffect(() => {
		if (!snapshot) return;
		const next = computeHighlightedId(snapshot);
		if (next === latestRef.current) return;
		latestRef.current = next;

		if (timerRef.current) clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			setHighlighted(next);
		}, DEBOUNCE_MS);

		return () => {
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [snapshot]);

	return highlighted;
}

function DashboardSkeleton() {
	return (
		<div className="flex min-h-screen flex-col">
			<div className="border-b border-border px-8 py-3">
				<Skeleton className="h-4 w-24" />
			</div>
			<div className="max-w-5xl space-y-6 px-8 py-6">
				<div className="space-y-4">
					<Skeleton className="h-4 w-16" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-16 w-full" />
				</div>
			</div>
		</div>
	);
}

export function Root({ children }: { children: ReactNode }) {
	const { data: snapshot, isLoading, isError, error } = useRuntimeState();

	const { status: sseStatus } = useEventStream();

	const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
	const highlightedIssueId = useAutoHighlight(snapshot);
	const refresh = useTriggerRefresh();

	const value = useMemo(
		() =>
			snapshot
				? {
						state: { snapshot, highlightedIssueId, focusedIssueId, sseStatus },
						actions: {
							focusIssue: setFocusedIssueId,
							triggerRefresh: () => refresh.mutate(),
						},
						meta,
					}
				: null,
		[snapshot, highlightedIssueId, focusedIssueId, sseStatus, refresh],
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
			<div className="flex min-h-screen flex-col">{children}</div>
		</DashboardContext>
	);
}
