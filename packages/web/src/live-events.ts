import { useEffect, useMemo, useState } from "react";
import {
	parsePlotEventRecord,
	instanceEventsUrl,
	type PlotEventRecord,
} from "./api.js";
import type { PlotInstance } from "./instance.js";

export interface SessionLiveState {
	readonly frontier: number;
	readonly eventCount: number;
	readonly lastType?: string | undefined;
	readonly lastAt?: string | undefined;
}

export type SessionLiveMap = Readonly<Record<string, SessionLiveState>>;

const reduceLiveState = (
	state: SessionLiveState | undefined,
	record: PlotEventRecord,
): SessionLiveState => {
	if (state !== undefined && record.event.sequence <= state.frontier)
		return state;
	return {
		frontier: record.event.sequence,
		eventCount: (state?.eventCount ?? 0) + 1,
		lastType: record.event.type,
		lastAt: record.event.timestamp,
	};
};

export const useSessionLiveEvents = (
	sessions: readonly PlotInstance[],
): SessionLiveMap => {
	const [live, setLive] = useState<SessionLiveMap>({});
	const keys = useMemo(
		() => sessions.map((session) => session.id).toSorted(),
		[sessions],
	);
	const keySignature = keys.join("\0");

	useEffect(() => {
		setLive((previous) =>
			Object.fromEntries(
				sessions.map((session) => [
					session.id,
					previous[session.id] ?? {
						frontier: session.lastSequence ?? 0,
						eventCount: 0,
						lastType: session.lastEventType,
						lastAt: session.lastSeenAt ?? session.createdAt,
					},
				]),
			),
		);
		// ponytail: stream every discovered session from the catalog frontier; replay full logs only for expanded detail views later.
		const sources = sessions.map((session) => {
			const source = new EventSource(
				instanceEventsUrl(session.id, session.lastSequence ?? 0),
			);
			source.addEventListener("plot", (message) => {
				const record = parsePlotEventRecord(
					JSON.parse(message.data) as unknown,
				);
				if (record === undefined) return;
				setLive((previous) => ({
					...previous,
					[session.id]: reduceLiveState(previous[session.id], record),
				}));
			});
			return source;
		});
		return () => {
			for (const source of sources) source.close();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keySignature is the stable session identity list.
	}, [keySignature]);

	return live;
};
