import { useState, useEffect, useCallback } from "react";
import type { AgentRuntimeEvent } from "@plot/sdk";
import { rpcClient } from "./runtime";

const POLL_INTERVAL = 3000;

export function useEventLog(identifier: string) {
	const [events, setEvents] = useState<readonly AgentRuntimeEvent[]>([]);
	const [isLoading, setIsLoading] = useState(false);

	const fetchEvents = useCallback(async (id: string, initial: boolean) => {
		if (initial) setIsLoading(true);
		try {
			const log = await rpcClient.getEventLog(id);
			setEvents(log.events);
		} catch {
			if (initial) setEvents([]);
		} finally {
			if (initial) setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!identifier) {
			setEvents([]);
			return;
		}

		void fetchEvents(identifier, true);

		const timer = setInterval(() => {
			void fetchEvents(identifier, false);
		}, POLL_INTERVAL);

		return () => clearInterval(timer);
	}, [identifier, fetchEvents]);

	return { events, isLoading };
}
