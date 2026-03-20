import { useSyncExternalStore } from "react";
import { useMutation } from "@tanstack/react-query";
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
