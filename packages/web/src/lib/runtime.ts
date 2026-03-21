import { useSyncExternalStore } from "react";
import { Schema } from "effect";
import { useMutation } from "@tanstack/react-query";
import { RuntimeSnapshot } from "@plot/sdk";
import { makePlotClient } from "@plot/sdk";

type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";

const decodeSnapshot = Schema.decodeUnknownSync(RuntimeSnapshot);

let snapshot: RuntimeSnapshot | null = null;
let status: SseStatus = "connecting";
const snapshotListeners = new Set<() => void>();
const statusListeners = new Set<() => void>();

function notifySnapshot() {
	for (const cb of snapshotListeners) cb();
}
function notifyStatus() {
	for (const cb of statusListeners) cb();
}

function connect() {
	const evtSource = new EventSource("/rpc/events");

	evtSource.onopen = () => {
		status = "connected";
		notifyStatus();
	};

	evtSource.onmessage = (event) => {
		try {
			snapshot = decodeSnapshot(JSON.parse(event.data));
			notifySnapshot();
		} catch (err) {
			console.warn("plot sse parse:", err instanceof Error ? err.message : String(err));
		}
	};

	evtSource.onerror = () => {
		status = "reconnecting";
		notifyStatus();
		evtSource.close();
		setTimeout(connect, 2000);
	};
}

connect();

export const rpcClient = makePlotClient("/rpc");

export function useRuntimeSnapshot(): RuntimeSnapshot | null {
	return useSyncExternalStore(
		(cb) => {
			snapshotListeners.add(cb);
			return () => {
				snapshotListeners.delete(cb);
			};
		},
		() => snapshot,
	);
}

export function useStreamStatus(): SseStatus {
	return useSyncExternalStore(
		(cb) => {
			statusListeners.add(cb);
			return () => {
				statusListeners.delete(cb);
			};
		},
		() => status,
	);
}

export function useTriggerRefresh() {
	return useMutation({
		mutationFn: () => rpcClient.triggerRefresh(),
	});
}
