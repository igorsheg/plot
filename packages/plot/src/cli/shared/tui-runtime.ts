import type {
	AgentRuntimeEvent,
	RuntimeSnapshot,
	JsonRpcNotification,
} from "@plot/sdk";
type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";
import type { RuntimeApi } from "@plot/tui";
import type { ServerOptions } from "./options.js";
import {
	resolveTuiServerLogPath,
	resolveTuiWorkerUrl,
	toTuiServerEnv,
} from "./runtime.js";

type WorkerReadyMessage = { type: "ready" };
type WorkerErrorMessage = { type: "error"; error: string };
type WorkerStoppedMessage = { type: "stopped" };

type WorkerLifecycleMessage =
	| WorkerReadyMessage
	| WorkerErrorMessage
	| WorkerStoppedMessage;

export interface TuiRuntimeHandle {
	api: RuntimeApi;
	close: () => void;
	logPath: string;
}

function isLifecycleMessage(msg: unknown): msg is WorkerLifecycleMessage {
	return typeof msg === "object" && msg !== null && "type" in msg;
}

function isJsonRpcNotification(msg: unknown): msg is JsonRpcNotification {
	return (
		typeof msg === "object" &&
		msg !== null &&
		"jsonrpc" in msg &&
		(msg as Record<string, unknown>)["jsonrpc"] === "2.0" &&
		"method" in msg
	);
}

export async function createTuiRuntimeHandle(
	serverOptions: ServerOptions,
): Promise<TuiRuntimeHandle> {
	const worker = new Worker(resolveTuiWorkerUrl(), { type: "module" });
	const logPath = resolveTuiServerLogPath();
	let status: SseStatus = "connecting";
	let onSnapshot: ((snapshot: RuntimeSnapshot) => void) | null = null;
	let onStatus: ((status: SseStatus) => void) | null = null;
	let onEvent: ((event: AgentRuntimeEvent) => void) | null = null;

	const setStatus = (next: SseStatus) => {
		status = next;
		onStatus?.(next);
	};

	const ready = new Promise<void>((resolve, reject) => {
		worker.onmessage = (event: MessageEvent) => {
			const message = event.data;

			if (isLifecycleMessage(message)) {
				if (message.type === "ready") {
					setStatus("connected");
					resolve();
					return;
				}
				if (message.type === "error") {
					setStatus("disconnected");
					reject(new Error(message.error));
					return;
				}
				if (message.type === "stopped") {
					setStatus("disconnected");
					return;
				}
			}

			if (isJsonRpcNotification(message)) {
				switch (message.method) {
					case "state/update":
						onSnapshot?.(
							(message.params as { snapshot: RuntimeSnapshot }).snapshot,
						);
						break;
					case "issue/event":
						onEvent?.((message.params as { event: AgentRuntimeEvent }).event);
						break;
				}
			}
		};
		worker.onerror = (event) => {
			setStatus("disconnected");
			reject(new Error(event.message));
		};
	});

	setStatus("connecting");
	worker.postMessage({ type: "start", env: toTuiServerEnv(serverOptions) });
	await ready;

	const close = () => {
		setStatus("disconnected");
		worker.postMessage({ type: "stop" });
		worker.terminate();
	};

	return {
		api: {
			connectSnapshots: (handleSnapshot, handleStatus) => {
				onSnapshot = handleSnapshot;
				onStatus = handleStatus;
				handleStatus(status);
				return () => {
					onSnapshot = null;
					onStatus = null;
				};
			},
			connectEvents: (handleEvent) => {
				onEvent = handleEvent;
				return () => {
					onEvent = null;
				};
			},
		} as RuntimeApi,
		close,
		logPath,
	};
}
