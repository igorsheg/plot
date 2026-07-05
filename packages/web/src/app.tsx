import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
	fetchRunProjection,
	fetchRuns,
	parsePlotEventRecord,
	recordObservation,
	runEventsUrl,
	stopRun,
	type ObservationInput,
	type WebDashboardProjection,
} from "./api.js";
import {
	isRunLive,
	LivenessBanner,
	NoLiveBoard,
	type BoardState,
} from "./board.js";
import { ActionQueueProvider } from "./action-queue.js";
import { Alert, AlertDescription } from "./components/ui/alert.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { SessionColumn } from "./column.js";
import { deriveFleet } from "./derive-fleet.js";
import { FleetBriefHome, FleetRail } from "./fleet.js";
import { Floor } from "./floor.js";
import { laneSignature } from "./lanes.js";
import { useRunLiveEvents } from "./live-events.js";
import { Masthead } from "./masthead.js";
import { Palette } from "./palette.js";
import { applyProjectionEvent } from "./projection-live.js";
import type { PlotRun } from "./run.js";
import { SessionProvider } from "./session-context.js";
import { ThemeProvider } from "./theme.js";
import { UndoRail } from "./undo-rail.js";
import { useNow } from "./use-countdown.js";

const errorText = (caught: unknown): string =>
	caught instanceof Error ? caught.message : String(caught);

/** Animate work moves with native view transitions when available. */
const commitProjection = (moved: boolean, commit: () => void): void => {
	if (moved && typeof document.startViewTransition === "function") {
		document.startViewTransition(() => flushSync(commit));
	} else {
		commit();
	}
};

const useFleetProjections = (
	runs: readonly PlotRun[],
): ReadonlyMap<string, WebDashboardProjection> => {
	const [projections, setProjections] = useState(
		() => new Map<string, WebDashboardProjection>(),
	);
	const latestRunsRef = useRef(runs);
	const inFlightRef = useRef(false);
	const pendingRef = useRef(false);
	useEffect(() => {
		let cancelled = false;
		latestRunsRef.current = runs;
		const runOnce = async (): Promise<void> => {
			pendingRef.current = false;
			const liveRuns = latestRunsRef.current.filter(isRunLive);
			const entries = await Promise.all(
				liveRuns.map(async (run) => {
					try {
						return [run.id, await fetchRunProjection(run.id)] as const;
					} catch {
						return undefined;
					}
				}),
			);
			if (cancelled) return;
			const liveIds = new Set(liveRuns.map((run) => run.id));
			setProjections((previous) => {
				const next = new Map(
					[...previous.entries()].filter(([runId]) => liveIds.has(runId)),
				);
				for (const entry of entries) {
					if (entry !== undefined) next.set(entry[0], entry[1]);
				}
				return next;
			});
			if (pendingRef.current) await runOnce();
		};
		const sweep = async () => {
			if (inFlightRef.current) {
				pendingRef.current = true;
				return;
			}
			inFlightRef.current = true;
			try {
				await runOnce();
			} finally {
				inFlightRef.current = false;
			}
		};
		void sweep();
		return () => {
			cancelled = true;
		};
	}, [runs]);
	return projections;
};

function LoadingColumn() {
	return (
		<div className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8">
			<Skeleton className="h-16 rounded-lg" />
			<Skeleton className="h-40 rounded-lg" />
			<Skeleton className="h-40 rounded-lg" />
		</div>
	);
}

export function PlotApp() {
	const [runs, setRuns] = useState<readonly PlotRun[]>([]);
	const [error, setError] = useState<string>();
	const [selectedStreamKey, setSelectedStreamKey] = useState<string>();
	const [board, setBoard] = useState<BoardState>({ loading: false });
	const projectionRef = useRef<WebDashboardProjection>(undefined);
	const nowMs = useNow();
	const fleetProjections = useFleetProjections(runs);
	const [selectedProjection, setSelectedProjection] = useState<
		WebDashboardProjection | undefined
	>();
	const [paletteOpen, setPaletteOpen] = useState(false);

	const updateRuns = useCallback(
		(next: readonly PlotRun[]) => setRuns(next),
		[],
	);
	useRunLiveEvents(runs, updateRuns);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const next = await fetchRuns();
				if (!cancelled) {
					setRuns(next);
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

	const streams = useMemo(
		() => deriveFleet(runs, fleetProjections, nowMs),
		[runs, fleetProjections, nowMs],
	);
	const selectedStream = streams.find(
		(stream) => stream.key === selectedStreamKey,
	);
	const selectedRun = selectedStream?.currentRun;
	const effectiveId = selectedRun?.id;

	useEffect(() => {
		if (streams.length === 0) {
			setSelectedStreamKey(undefined);
			return;
		}
		if (selectedStreamKey !== undefined && selectedStream === undefined) {
			setSelectedStreamKey(undefined);
		}
	}, [selectedStream, selectedStreamKey, streams]);

	useEffect(() => {
		projectionRef.current = undefined;
		setSelectedProjection(undefined);
		if (effectiveId === undefined || selectedRun === undefined) {
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
				setSelectedProjection(initial);
				setBoard({ loading: false, live: true, projection: initial });
				if (!isRunLive(selectedRun)) return;
				source = new EventSource(runEventsUrl(effectiveId, initial.frontier));
				source.addEventListener("open", () =>
					setBoard((previous) => ({ ...previous, live: true })),
				);
				source.addEventListener("error", () =>
					setBoard((previous) => ({ ...previous, live: false })),
				);
				source.addEventListener("plot", (message) => {
					const record = parsePlotEventRecord(
						JSON.parse(message.data) as unknown,
					);
					const current = projectionRef.current;
					if (record === undefined || current === undefined) return;
					const next = applyProjectionEvent(current, record);
					if (next === current) return;
					projectionRef.current = next;
					commitProjection(
						laneSignature(current) !== laneSignature(next),
						() => {
							setSelectedProjection(next);
							setBoard({ loading: false, projection: next });
						},
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
	}, [effectiveId, selectedRun]);

	const onStop = async (id: string) => {
		try {
			await stopRun(id);
			setRuns(await fetchRuns());
		} catch (caught) {
			setError(errorText(caught));
		}
	};

	const onAction = async (input: ObservationInput): Promise<boolean> => {
		if (effectiveId === undefined) return false;
		return recordObservation(effectiveId, input);
	};

	const blockedCount = streams.reduce(
		(sum, stream) => sum + stream.needsYou,
		0,
	);
	useEffect(() => {
		document.title = blockedCount > 0 ? `(${blockedCount}) Plot` : "Plot";
	}, [blockedCount]);

	return (
		<ThemeProvider>
			<TooltipProvider>
				<ActionQueueProvider record={onAction}>
					<div className="flex h-full">
						<FleetRail
							onHome={() => setSelectedStreamKey(undefined)}
							onOpenPalette={() => setPaletteOpen(true)}
							onSelect={setSelectedStreamKey}
							selectedKey={selectedStreamKey}
							streams={streams}
						/>
						<main className="flex min-h-0 min-w-0 flex-1 flex-col">
							{error !== undefined && (
								<Alert
									variant="error"
									className="rounded-none border-x-0 border-t-0"
								>
									<AlertDescription>{error}</AlertDescription>
								</Alert>
							)}
							{selectedStream === undefined || selectedRun === undefined ? (
								<>
									<FleetBriefHome
										onSelect={setSelectedStreamKey}
										projections={fleetProjections}
										streams={streams}
									/>
									<Palette
										onOpenChange={setPaletteOpen}
										onSelectStream={setSelectedStreamKey}
										open={paletteOpen}
										streams={streams}
									/>
								</>
							) : (
								<SessionProvider
									act={onAction}
									live={board.live}
									projection={selectedProjection}
									run={selectedRun}
									stop={() => void onStop(selectedRun.id)}
								>
									<Masthead
										onStop={() => void onStop(selectedRun.id)}
										projection={selectedProjection}
										run={selectedRun}
										stream={selectedStream}
									/>
									<LivenessBanner run={selectedRun} state={board} />
									{board.error !== undefined &&
									selectedProjection === undefined ? (
										<NoLiveBoard error={board.error} run={selectedRun} />
									) : selectedProjection === undefined ? (
										<LoadingColumn />
									) : (
										<>
											<SessionColumn
												paletteOpen={paletteOpen}
												projection={selectedProjection}
												run={selectedRun}
											/>
											<Floor />
										</>
									)}
									<Palette
										onOpenChange={setPaletteOpen}
										onSelectStream={setSelectedStreamKey}
										open={paletteOpen}
										streams={streams}
									/>
								</SessionProvider>
							)}
						</main>
					</div>
					<UndoRail />
				</ActionQueueProvider>
			</TooltipProvider>
		</ThemeProvider>
	);
}
