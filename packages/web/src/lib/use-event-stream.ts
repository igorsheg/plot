import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	connectSse,
	type AgentRuntimeEvent,
	type SseStatus,
} from "@plot/sdk";

type EventHandler = (event: AgentRuntimeEvent) => void;

export function useEventStream() {
	const queryClient = useQueryClient();
	const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
	const lastInvalidateRef = useRef(0);
	const [status, setStatus] = useState<SseStatus>("connecting");

	useEffect(() => {
		const THROTTLE_MS = 500;

		const conn = connectSse(
			"/rpc/events",
			(event) => {
				const issueId = event.issueId;

				if (issueId) {
					const handlers = handlersRef.current.get(issueId);
					if (handlers) {
						for (const handler of handlers) handler(event);
					}
				}

				const now = Date.now();
				if (now - lastInvalidateRef.current >= THROTTLE_MS) {
					lastInvalidateRef.current = now;
					queryClient.invalidateQueries({ queryKey: ["state"] });
					if (event.issueIdentifier) {
						queryClient.invalidateQueries({
							queryKey: ["issue", event.issueIdentifier],
						});
					}
				}
			},
			(newStatus) => {
				setStatus(newStatus);
				if (newStatus === "connected") {
					queryClient.invalidateQueries({ queryKey: ["state"] });
				}
			},
		);

		return () => {
			conn.close();
		};
	}, [queryClient]);

	const subscribe = useCallback(
		(issueId: string, handler: EventHandler): (() => void) => {
			let handlers = handlersRef.current.get(issueId);
			if (!handlers) {
				handlers = new Set();
				handlersRef.current.set(issueId, handlers);
			}
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
				if (handlers.size === 0) handlersRef.current.delete(issueId);
			};
		},
		[],
	);

	return { subscribe, status };
}
