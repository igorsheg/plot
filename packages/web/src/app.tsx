import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import {
	SideNav,
	SideNavHeading,
	SideNavItem,
} from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { SessionBoard, useHeartbeat, type BoardState } from "./board.js";
import { laneSignature } from "./lanes.js";
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

const statusDotVariant = (status: string): "success" | "error" | "neutral" =>
	status === "online" || status === "running"
		? "success"
		: status === "error" || status === "failed"
			? "error"
			: "neutral";

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
	useHeartbeat();
	return (
		<SideNav
			header={
				<SideNavHeading
					heading="Plot"
					subheading={`${runs.length} session${runs.length === 1 ? "" : "s"}`}
				/>
			}
			footerIcons={<ThemeToggle />}
		>
			{runs.map((run) => (
				<SideNavItem
					key={run.id}
					label={run.workflowName ?? run.id}
					isSelected={run.id === selectedId}
					onClick={() => onSelect(run.id)}
					icon={
						<StatusDot
							variant={statusDotVariant(run.status)}
							isPulsing={run.status === "running"}
							label={run.status}
						/>
					}
					endContent={`${run.cwdName ?? run.cwd} · ${formatSeen(run)}`}
				/>
			))}
		</SideNav>
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
	const selectedIsLive = selectedRun !== undefined && isLive(selectedRun);

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
				setBoard({ loading: false, live: true, projection: initial });
				// Ended sessions serve a replayed history board; nothing to stream.
				if (!selectedIsLive) return;
				source = new EventSource(runEventsUrl(effectiveId, initial.frontier));
				source.addEventListener("open", () =>
					setBoard((previous) => ({ ...previous, live: true })),
				);
				// EventSource auto-reconnects (resuming via Last-Event-ID); we only
				// surface the gap so the operator knows the board may lag.
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
	}, [effectiveId, selectedIsLive]);

	const onStop = async (id: string) => {
		try {
			await stopRun(id);
			setRuns(sortRuns(await fetchRuns()));
		} catch (caught) {
			setError(errorText(caught));
		}
	};

	const onAction = async (input: ObservationInput): Promise<boolean> => {
		if (effectiveId === undefined) return false;
		return recordObservation(effectiveId, input);
	};

	// Needs You reaches the tab bar; the operator is elsewhere by definition.
	// ponytail: counts the selected session only; fleet-wide counts need
	// registry support.
	const blockedCount =
		board.projection === undefined
			? 0
			: Object.values(board.projection.work).filter(
					(work) => work.status === "blocked",
				).length;
	useEffect(() => {
		document.title = blockedCount > 0 ? `(${blockedCount}) Plot` : "Plot";
	}, [blockedCount]);

	return (
		<ThemeProvider>
			<AppShell
				height="fill"
				variant="elevated"
				contentPadding={0}
				sideNav={
					<SessionRail
						runs={runs}
						selectedId={effectiveId}
						onSelect={setSelectedId}
					/>
				}
			>
				<div className="plot-app-content">
					{error !== undefined && (
						<Banner
							status="error"
							container="section"
							title="Connection error"
							description={error}
						/>
					)}
					{effectiveId === undefined || selectedRun === undefined ? (
						<div className="plot-center">
							<EmptyState
								title="No Plot sessions"
								description="Start one with `plot tui --workflow WORKFLOW.md`; it will appear here live."
							/>
						</div>
					) : (
						<SessionBoard
							run={selectedRun}
							state={board}
							onAction={onAction}
							onStop={() => void onStop(effectiveId)}
						/>
					)}
				</div>
			</AppShell>
		</ThemeProvider>
	);
}
