import { useState, useEffect, useRef, useCallback } from "react";
import { DateTime } from "effect";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { stream } from "./runtime";

const toEpoch = (ts: DateTime.Utc) => Number(DateTime.toEpochMillis(ts));

const MAX_CLIENT_LOG = 2000;

export function useEventLog(identifier: string) {
	const [events, setEvents] = useState<readonly AgentRuntimeEvent[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const issueIdRef = useRef<string | null>(null);
	const seenTimestampsRef = useRef(0);

	const fetchInitial = useCallback(async (id: string) => {
		setIsLoading(true);
		try {
			const log = await stream.getEventLog(id);
			issueIdRef.current = log.issueId;
			const evts = log.events;
			seenTimestampsRef.current = evts.length > 0 ? toEpoch(evts[evts.length - 1]!.timestamp) : 0;
			setEvents(evts);
		} catch {
			setEvents([]);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!identifier) {
			setEvents([]);
			issueIdRef.current = null;
			seenTimestampsRef.current = 0;
			return;
		}

		void fetchInitial(identifier);
	}, [identifier, fetchInitial]);

	useEffect(() => {
		if (!identifier) return;

		return stream.onEvent((event) => {
			if (
				issueIdRef.current &&
				event.issueId === issueIdRef.current &&
				toEpoch(event.timestamp) > seenTimestampsRef.current
			) {
				seenTimestampsRef.current = toEpoch(event.timestamp);
				setEvents((prev) => {
					if (
						event.event === "notification" &&
						prev.length > 0 &&
						prev[prev.length - 1]!.event === "notification"
					) {
						const last = prev[prev.length - 1]!;
						const merged = {
							...last,
							timestamp: event.timestamp,
							message: (last.message ?? "") + (event.message ?? ""),
						} as AgentRuntimeEvent;
						return [...prev.slice(0, -1), merged];
					}
					const next = [...prev, event];
					return next.length > MAX_CLIENT_LOG ? next.slice(-MAX_CLIENT_LOG) : next;
				});
			}
		});
	}, [identifier]);

	return { events, isLoading };
}
