import { useEffect, useState } from "react";
import {
	parseRunCatalogEvent,
	runCatalogEventsUrl,
	type RunCatalogEvent,
} from "./api.js";
import type { PlotRun } from "./run.js";

export interface RunLiveState {
	readonly frontier: number;
	readonly eventCount: number;
	readonly lastType?: string | undefined;
	readonly lastAt?: string | undefined;
}

export type RunLiveMap = Readonly<Record<string, RunLiveState>>;

const runLiveState = (
	previous: RunLiveState | undefined,
	run: PlotRun,
): RunLiveState => {
	const frontier = run.lastSequence ?? previous?.frontier ?? 0;
	const lastType = run.lastEventType ?? previous?.lastType ?? run.status;
	const lastAt = run.lastSeenAt ?? previous?.lastAt ?? run.createdAt;
	const changed =
		previous !== undefined &&
		(frontier !== previous.frontier ||
			lastType !== previous.lastType ||
			lastAt !== previous.lastAt);
	return {
		frontier,
		eventCount: (previous?.eventCount ?? 0) + (changed ? 1 : 0),
		lastType,
		lastAt,
	};
};

const reduceLiveMap = (
	previous: RunLiveMap,
	runs: readonly PlotRun[],
): RunLiveMap =>
	Object.fromEntries(
		runs.map((run) => [run.id, runLiveState(previous[run.id], run)]),
	);

export const useRunLiveEvents = (
	runs: readonly PlotRun[],
	onRuns: (runs: readonly PlotRun[]) => void,
): RunLiveMap => {
	const [live, setLive] = useState<RunLiveMap>({});

	useEffect(() => {
		setLive((previous) => reduceLiveMap(previous, runs));
	}, [runs]);

	useEffect(() => {
		const source = new EventSource(runCatalogEventsUrl());
		const apply = (event: RunCatalogEvent) => {
			onRuns(event.runs);
			setLive((previous) => reduceLiveMap(previous, event.runs));
		};
		source.addEventListener("plot", (message) => {
			const event = parseRunCatalogEvent(JSON.parse(message.data) as unknown);
			if (event !== undefined) apply(event);
		});
		return () => source.close();
	}, [onRuns]);

	return live;
};
