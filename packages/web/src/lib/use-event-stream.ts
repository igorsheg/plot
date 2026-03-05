import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type EventHandler = (event: unknown) => void;
type ConnectionStatus = "connected" | "connecting" | "disconnected";

export function useEventStream() {
  const queryClient = useQueryClient();
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const lastInvalidateRef = useRef(0);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    const source = new EventSource("/rpc/events");
    const THROTTLE_MS = 500;

    source.onopen = () => {
      setStatus("connected");
    };

    source.onmessage = (msg) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(msg.data) as Record<string, unknown>;
      } catch {
        return;
      }

      const issueId = parsed["issueId"] as string | undefined;

      if (issueId) {
        const handlers = handlersRef.current.get(issueId);
        if (handlers) {
          for (const handler of handlers) handler(parsed);
        }
      }

      const now = Date.now();
      if (now - lastInvalidateRef.current >= THROTTLE_MS) {
        lastInvalidateRef.current = now;
        queryClient.invalidateQueries({ queryKey: ["state"] });
        if (issueId) {
          queryClient.invalidateQueries({
            queryKey: ["issue"],
            predicate: (query) => query.queryKey[0] === "issue" && query.queryKey.length > 1,
          });
        }
      }
    };

    source.onerror = () => {
      // Only set disconnected if EventSource is actually closed
      if (source.readyState === EventSource.CLOSED) {
        setStatus("disconnected");
      } else {
        setStatus("connecting");
      }
    };

    return () => {
      source.close();
    };
  }, [queryClient]);

  const subscribe = useCallback((issueId: string, handler: EventHandler): (() => void) => {
    if (!handlersRef.current.has(issueId)) {
      handlersRef.current.set(issueId, new Set());
    }
    handlersRef.current.get(issueId)!.add(handler);
    return () => {
      const set = handlersRef.current.get(issueId);
      set?.delete(handler);
      if (set?.size === 0) handlersRef.current.delete(issueId);
    };
  }, []);

  return { subscribe, status };
}
