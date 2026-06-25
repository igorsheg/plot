import { useEffect, useMemo, useState } from "react";
import {
	parsePlotEventRecord,
	sessionEventsUrl,
	type PlotEventRecord,
} from "./api.js";
import type { PlotSessionRegistration } from "./registration.js";

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
	sessions: readonly PlotSessionRegistration[],
): SessionLiveMap => {
	const [live, setLive] = useState<SessionLiveMap>({});
	const keys = useMemo(
		() => sessions.map((session) => session.key).toSorted(),
		[sessions],
	);
	const keySignature = keys.join("\0");

	useEffect(() => {
		setLive((previous) =>
			Object.fromEntries(
				sessions.map((session) => [
					session.key,
					previous[session.key] ?? {
						frontier: session.lastSequence,
						eventCount: 0,
						lastType: session.lastEventType,
						lastAt: session.heartbeatAt,
					},
				]),
			),
		);
		// ponytail: stream every discovered session from the catalog frontier; replay full logs only for expanded detail views later.
		const sources = sessions.map((session) => {
			const source = new EventSource(
				sessionEventsUrl(session.key, session.lastSequence),
			);
			source.addEventListener("plot", (message) => {
				const record = parsePlotEventRecord(
					JSON.parse(message.data) as unknown,
				);
				if (record === undefined) return;
				setLive((previous) => ({
					...previous,
					[session.key]: reduceLiveState(previous[session.key], record),
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
