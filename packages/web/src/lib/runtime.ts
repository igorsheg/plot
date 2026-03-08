import { useSyncExternalStore } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RuntimeStream, type RuntimeSnapshot, type SseStatus } from "@plot/sdk";

export const stream = new RuntimeStream("/rpc");

const serverSnapshot = (): RuntimeSnapshot | null => null;
const serverStatus = (): SseStatus => "connecting";

export function useRuntimeSnapshot(): RuntimeSnapshot | null {
  return useSyncExternalStore(stream.subscribe, stream.getSnapshot, serverSnapshot);
}

export function useStreamStatus(): SseStatus {
  return useSyncExternalStore(stream.subscribeStatus, stream.getStatus, serverStatus);
}

export function useTriggerRefresh() {
  return useMutation({
    mutationFn: () => stream.triggerRefresh(),
  });
}

export function useIssueDetail(identifier: string) {
  return useQuery({
    queryKey: ["issue", identifier] as const,
    queryFn: () => stream.getIssue(identifier),
    enabled: !!identifier,
    refetchInterval: 60_000,
  });
}
