import { Schema } from "effect";
import {
	AgentRuntimeEvent,
	RuntimeSnapshot,
} from "@plot/sdk";
type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";
import type { RuntimeApi } from "@plot/tui";
import type { ServerOptions } from "./options.js";
import { resolveTuiServerLogPath, resolveTuiWorkerUrl, toTuiServerEnv } from "./runtime.js";

type WorkerReadyMessage = { type: "ready" };
type WorkerSnapshotMessage = { type: "snapshot"; snapshot: unknown };
type WorkerEventMessage = { type: "event"; event: unknown };
type WorkerErrorMessage = { type: "error"; error: string };

type WorkerMessage =
	| WorkerReadyMessage
	| WorkerSnapshotMessage
	| WorkerEventMessage
	| WorkerErrorMessage;

const decodeSnapshot = Schema.decodeUnknownSync(RuntimeSnapshot);
const decodeEvent = Schema.decodeUnknownSync(AgentRuntimeEvent);

export interface TuiRuntimeHandle {
	api: RuntimeApi;
	close: () => void;
	logPath: string;
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
		worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
			const message = event.data;
			if (message.type === "ready") {
				setStatus("connected");
				resolve();
				return;
			}
			if (message.type === "snapshot") {
				onSnapshot?.(decodeSnapshot(message.snapshot));
				return;
			}
			if (message.type === "event") {
				onEvent?.(decodeEvent(message.event));
				return;
			}
			if (message.type === "error") {
				setStatus("disconnected");
				reject(new Error(message.error));
				return;
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
		},
		close,
		logPath,
	};
}
