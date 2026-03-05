import { useEffectQuery, useEffectMutation, useRpcClient } from "@/lib/rpc-client";

export function useRuntimeState(options?: { refetchInterval?: number }) {
  const rpc = useRpcClient();
  return useEffectQuery({
    queryKey: ["state"] as const,
    queryFn: () => rpc.getState(),
    refetchInterval: options?.refetchInterval ?? 2000,
  });
}

export function useIssueDetail(identifier: string) {
  const rpc = useRpcClient();
  return useEffectQuery({
    queryKey: ["issue", identifier] as const,
    queryFn: () => rpc.getIssue(identifier),
    enabled: !!identifier,
    refetchInterval: 10_000,
  });
}

export function useTriggerRefresh() {
  const rpc = useRpcClient();
  return useEffectMutation({
    mutationFn: () => rpc.triggerRefresh(),
  });
}
