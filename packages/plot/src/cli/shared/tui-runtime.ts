import { Schema } from "effect";
import { AgentRuntimeEvent, RefreshResult, RuntimeSnapshot, type SseStatus } from "@plot/sdk";
import type { ServerOptions } from "./options.js";
import { resolveTuiServerLogPath, resolveTuiServerWorkerPath, toTuiServerEnv } from "./runtime.js";

type WorkerReadyMessage = {
  type: "ready";
};

type WorkerEventMessage = {
  type: "event";
  event: unknown;
};

type WorkerErrorMessage = {
  type: "error";
  error: string;
};

type WorkerResponseMessage =
  | {
      type: "response";
      id: number;
      ok: true;
      result: unknown;
    }
  | {
      type: "response";
      id: number;
      ok: false;
      error: string;
    };

type WorkerMessage =
  | WorkerReadyMessage
  | WorkerEventMessage
  | WorkerErrorMessage
  | WorkerResponseMessage;

const decodeEvent = Schema.decodeUnknownSync(AgentRuntimeEvent);
const decodeSnapshot = Schema.decodeUnknownSync(RuntimeSnapshot);
const decodeRefreshResult = Schema.decodeUnknownSync(RefreshResult);

type RuntimeApi = {
  getState: () => Promise<RuntimeSnapshot>;
  triggerRefresh: () => Promise<RefreshResult>;
  connectEvents: (
    handleEvent: (event: AgentRuntimeEvent) => void,
    handleStatus: (status: SseStatus) => void,
  ) => () => void;
};

export interface TuiRuntimeHandle {
  api: RuntimeApi;
  close: () => void;
  logPath: string;
}

export async function createTuiRuntimeHandle(
  serverOptions: ServerOptions,
): Promise<TuiRuntimeHandle> {
  const worker = new Worker(resolveTuiServerWorkerPath(), { type: "module" });
  const logPath = resolveTuiServerLogPath();
  let status: SseStatus = "connecting";
  let onEvent: ((event: AgentRuntimeEvent) => void) | null = null;
  let onStatus: ((status: SseStatus) => void) | null = null;
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
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

  const call = (method: "getState" | "triggerRefresh") =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "call", id, method });
    });

  const close = () => {
    setStatus("disconnected");
    failPending("tui runtime closed");
    worker.postMessage({ type: "stop" });
    worker.terminate();
  };

  return {
    api: {
      getState: async () => decodeSnapshot(await call("getState")),
      triggerRefresh: async () => decodeRefreshResult(await call("triggerRefresh")),
      connectEvents: (handleEvent, handleStatus) => {
        onEvent = handleEvent;
        onStatus = handleStatus;
        handleStatus(status);
        return () => {
          onEvent = null;
          onStatus = null;
        };
      },
    },
    close,
    logPath,
  };
}
