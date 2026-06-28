import { useEffect, useMemo, useState } from "react";
import {
	parsePlotEventRecord,
	runEventsUrl,
	type PlotEventRecord,
} from "./api.js";
import type { PlotRun } from "./run.js";

export interface RunLiveState {
	readonly frontier: number;
	readonly eventCount: number;
	readonly lastType?: string | undefined;
	readonly lastAt?: string | undefined;
}

export type RunLiveMap = Readonly<Record<string, RunLiveState>>;

const reduceLiveState = (
	state: RunLiveState | undefined,
	record: PlotEventRecord,
): RunLiveState => {
	if (state !== undefined && record.event.sequence <= state.frontier)
		return state;
	return {
		frontier: record.event.sequence,
		eventCount: (state?.eventCount ?? 0) + 1,
		lastType: record.event.type,
		lastAt: record.event.timestamp,
	};
};

export const useRunLiveEvents = (runs: readonly PlotRun[]): RunLiveMap => {
	const [live, setLive] = useState<RunLiveMap>({});
	const keys = useMemo(() => runs.map((run) => run.id).toSorted(), [runs]);
	const keySignature = keys.join("\0");

	useEffect(() => {
		setLive((previous) =>
			Object.fromEntries(
				runs.map((run) => [
					run.id,
					previous[run.id] ?? {
						frontier: run.lastSequence ?? 0,
						eventCount: 0,
						lastType: run.lastEventType,
						lastAt: run.lastSeenAt ?? run.createdAt,
					},
				]),
			),
		);
		// ponytail: stream every discovered run from the catalog frontier; replay full logs only for expanded detail views later.
		const sources = runs.map((run) => {
			const source = new EventSource(
				runEventsUrl(run.id, run.lastSequence ?? 0),
			);
			source.addEventListener("plot", (message) => {
				const record = parsePlotEventRecord(
					JSON.parse(message.data) as unknown,
				);
				if (record === undefined) return;
				setLive((previous) => ({
					...previous,
					[run.id]: reduceLiveState(previous[run.id], record),
				}));
			});
			return source;
		});
		return () => {
			for (const source of sources) source.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keySignature is the stable run identity list.
	}, [keySignature]);

	return live;
};
