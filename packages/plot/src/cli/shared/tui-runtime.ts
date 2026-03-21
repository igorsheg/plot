import { Schema } from "effect";
import {
	AgentRuntimeEvent,
	IssueEventLog,
	RefreshResult,
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
type WorkerResponseMessage =
	| { type: "response"; id: number; ok: true; result: unknown }
	| { type: "response"; id: number; ok: false; error: string };

type WorkerMethod = "triggerRefresh" | "getEventLog";

type WorkerMessage =
	| WorkerReadyMessage
	| WorkerSnapshotMessage
	| WorkerEventMessage
	| WorkerErrorMessage
	| WorkerResponseMessage;

const decodeSnapshot = Schema.decodeUnknownSync(RuntimeSnapshot);
const decodeEvent = Schema.decodeUnknownSync(AgentRuntimeEvent);
const decodeRefreshResult = Schema.decodeUnknownSync(RefreshResult);
const decodeIssueEventLog = Schema.decodeUnknownSync(IssueEventLog);

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
	let nextId = 1;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();

	const setStatus = (next: SseStatus) => {
		status = next;
		onStatus?.(next);
	};

	const failPending = (message: string) => {
		for (const request of pending.values()) {
			request.reject(new Error(message));
		}
		pending.clear();
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
				failPending(message.error);
				reject(new Error(message.error));
				return;
			}
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			if (message.ok) {
				request.resolve(message.result);
				return;
			}
			request.reject(new Error(message.error));
		};
		worker.onerror = (event) => {
			setStatus("disconnected");
			failPending(event.message);
			reject(new Error(event.message));
		};
	});

	setStatus("connecting");
	worker.postMessage({ type: "start", env: toTuiServerEnv(serverOptions) });
	await ready;

	const call = (method: WorkerMethod, identifier?: string) =>
		new Promise<unknown>((resolve, reject) => {
			const id = nextId++;
			pending.set(id, { resolve, reject });
			worker.postMessage({ type: "call", id, method, identifier });
		});

	const close = () => {
		setStatus("disconnected");
		failPending("tui runtime closed");
		worker.postMessage({ type: "stop" });
		worker.terminate();
	};

	return {
		api: {
			triggerRefresh: async () => decodeRefreshResult(await call("triggerRefresh")),
			getEventLog: async (identifier: string) =>
				decodeIssueEventLog(await call("getEventLog", identifier)),
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
