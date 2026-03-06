import { useQuery, useMutation } from "@tanstack/react-query";
import { useRpcClient } from "@/lib/rpc-client";

export function useRuntimeState(options?: {
	refetchInterval?: number | false;
}) {
	const rpc = useRpcClient();
	return useQuery({
		queryKey: ["state"] as const,
		queryFn: () => rpc.getState(),
		refetchInterval: options?.refetchInterval ?? 60_000,
	});
}

export function useIssueDetail(identifier: string) {
	const rpc = useRpcClient();
	return useQuery({
		queryKey: ["issue", identifier] as const,
		queryFn: () => rpc.getIssue(identifier),
		enabled: !!identifier,
		refetchInterval: 60_000,
	});
}

export function useTriggerRefresh() {
	const rpc = useRpcClient();
	return useMutation({
		mutationFn: () => rpc.triggerRefresh(),
	});
}
