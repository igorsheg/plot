import { useEffect, useMemo, useState } from "react";
import type { PlotSessionRegistration } from "./registration.js";

export interface SessionLiveState {
	readonly frontier: number;
	readonly eventCount: number;
	readonly lastType?: string | undefined;
	readonly lastAt?: string | undefined;
}

export type SessionLiveMap = Readonly<Record<string, SessionLiveState>>;

interface PlotEventRecord {
	readonly kind: "event";
	readonly event: {
		readonly sequence: number;
		readonly timestamp: string;
		readonly type: string;
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const parsePlotEventRecord = (value: unknown): PlotEventRecord | undefined => {
	if (!isRecord(value) || value["kind"] !== "event") return undefined;
	const event = value["event"];
	if (!isRecord(event)) return undefined;
	if (
		typeof event["sequence"] !== "number" ||
		typeof event["timestamp"] !== "string" ||
		typeof event["type"] !== "string"
	)
		return undefined;
	return {
		kind: "event",
		event: {
			sequence: event["sequence"],
			timestamp: event["timestamp"],
			type: event["type"],
		},
	};
};

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
				`/api/sessions/${session.key}/events?after=${session.lastSequence}`,
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
