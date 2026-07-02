import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
	fetchRunProjection,
	fetchRuns,
	parsePlotEventRecord,
	runEventsUrl,
	stopRun,
	type WebDashboardProjection,
} from "./api.js";
import { SessionBoard, type BoardState } from "./board.js";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Dot } from "./components/ui/dot.js";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "./components/ui/empty.js";
import { ScrollArea } from "./components/ui/scroll-area.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { laneSignature } from "./lanes.js";
import { cn } from "./lib/utils.js";
import { useRunLiveEvents } from "./live-events.js";
import { applyProjectionEvent } from "./projection-live.js";
import type { PlotRun } from "./run.js";
import { ThemeProvider, ThemeToggle } from "./theme.js";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

const isLive = (run: PlotRun): boolean =>
	run.status === "online" || run.status === "running";

/** Live sessions first, then most recently seen. */
const sortRuns = (runs: readonly PlotRun[]): readonly PlotRun[] =>
	runs.toSorted((left, right) => {
		const alive = Number(isLive(right)) - Number(isLive(left));
		if (alive !== 0) return alive;
		return (
			Date.parse(right.lastSeenAt ?? right.createdAt) -
			Date.parse(left.lastSeenAt ?? left.createdAt)
		);
	});

const runDot = (status: string): string | undefined =>
	status === "online" || status === "running"
		? "bg-success"
		: status === "error" || status === "failed"
			? "bg-destructive"
			: undefined;

const formatSeen = (run: PlotRun): string => {
	const ms = Date.parse(run.lastSeenAt ?? run.createdAt);
	if (!Number.isFinite(ms)) return "";
	const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
	if (seconds < 60) return `${seconds}s ago`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
	return `${Math.round(seconds / 3600)}h ago`;
};

/** Animate lane moves with native view transitions when available. */
const commitProjection = (moved: boolean, commit: () => void): void => {
	if (moved && typeof document.startViewTransition === "function") {
		document.startViewTransition(() => flushSync(commit));
	} else {
		commit();
	}
};

function SessionRail({
	onSelect,
	runs,
	selectedId,
}: {
	readonly onSelect: (id: string) => void;
	readonly runs: readonly PlotRun[];
	readonly selectedId: string | undefined;
}) {
	return (
		<aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar">
			<div className="flex items-center border-b px-4 py-2.5">
				<span className="font-semibold">Plot</span>
				<span className="ml-2 text-xs text-muted-foreground">
					{runs.length} session{runs.length === 1 ? "" : "s"}
				</span>
				<div className="ml-auto">
					<ThemeToggle />
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1" scrollFade>
				<nav className="space-y-1 p-2">
					{runs.map((run) => (
						<button
							key={run.id}
							type="button"
							onClick={() => onSelect(run.id)}
							className={cn(
								"w-full rounded-md px-3 py-2 text-left hover:bg-sidebar-accent",
								run.id === selectedId && "bg-sidebar-accent",
							)}
						>
							<div className="flex items-center gap-2">
								<Dot className={cn("size-2", runDot(run.status))} />
								<span className="truncate text-sm font-medium text-sidebar-accent-foreground">
									{run.workflowName ?? run.id}
								</span>
							</div>
							<div className="truncate pl-4 text-xs text-muted-foreground">
								{run.cwdName ?? run.cwd} · {formatSeen(run)}
							</div>
						</button>
					))}
				</nav>
			</ScrollArea>
		</aside>
	);
}

export function PlotApp() {
	const [runs, setRuns] = useState<readonly PlotRun[]>([]);
	const [error, setError] = useState<string>();
	const [selectedId, setSelectedId] = useState<string>();
	const [board, setBoard] = useState<BoardState>({ loading: false });
	const projectionRef = useRef<WebDashboardProjection>(undefined);

	const updateRuns = useCallback(
		(next: readonly PlotRun[]) => setRuns(sortRuns(next)),
		[],
	);
	useRunLiveEvents(runs, updateRuns);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const next = await fetchRuns();
				if (!cancelled) {
					setRuns(sortRuns(next));
					setError(undefined);
				}
			} catch (caught) {
				if (!cancelled) setError(errorText(caught));
			}
		};
		void load();
		const interval = setInterval(() => void load(), 10_000);
		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, []);

	const effectiveId =
		selectedId !== undefined && runs.some((run) => run.id === selectedId)
			? selectedId
			: runs[0]?.id;
	const selectedRun = runs.find((run) => run.id === effectiveId);

	useEffect(() => {
		projectionRef.current = undefined;
		if (effectiveId === undefined) {
			setBoard({ loading: false });
			return;
		}
		let cancelled = false;
		let source: EventSource | undefined;
		setBoard({ loading: true });
		void (async () => {
			try {
				const initial = await fetchRunProjection(effectiveId);
				if (cancelled) return;
				projectionRef.current = initial;
				setBoard({ loading: false, projection: initial });
				source = new EventSource(runEventsUrl(effectiveId, initial.frontier));
				source.addEventListener("plot", (message) => {
					const record = parsePlotEventRecord(
						JSON.parse(message.data) as unknown,
					);
					const current = projectionRef.current;
					if (record === undefined || current === undefined) return;
					const next = applyProjectionEvent(current, record);
					if (next === current) return;
					projectionRef.current = next;
					commitProjection(laneSignature(current) !== laneSignature(next), () =>
						setBoard({ loading: false, projection: next }),
					);
				});
			} catch (caught) {
				if (!cancelled) setBoard({ loading: false, error: errorText(caught) });
			}
		})();
		return () => {
			cancelled = true;
			source?.close();
		};
	}, [effectiveId]);

	const onStop = async (id: string) => {
		try {
			await stopRun(id);
			setRuns(sortRuns(await fetchRuns()));
		} catch (caught) {
			setError(errorText(caught));
		}
	};

	return (
		<ThemeProvider>
			<TooltipProvider>
				<div className="flex h-full">
					<SessionRail
						runs={runs}
						selectedId={effectiveId}
						onSelect={setSelectedId}
					/>
					<main className="flex min-w-0 flex-1 flex-col">
						{error !== undefined && (
							<Alert
								variant="error"
								className="rounded-none border-x-0 border-t-0"
							>
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}
						{effectiveId === undefined || selectedRun === undefined ? (
							<div className="grid flex-1 place-items-center">
								<Empty>
									<EmptyHeader>
										<EmptyTitle>No Plot sessions</EmptyTitle>
										<EmptyDescription>
											Start one with `plot tui --workflow WORKFLOW.md`; it will
											appear here live.
										</EmptyDescription>
									</EmptyHeader>
								</Empty>
							</div>
						) : (
							<SessionBoard
								run={selectedRun}
								state={board}
								onStop={() => void onStop(effectiveId)}
							/>
						)}
					</main>
				</div>
			</TooltipProvider>
		</ThemeProvider>
	);
}
