import { connectSse, type SseStatus, type SseConnection } from "./sse.js";
import { makePlotClient } from "./client.js";
import { RuntimeSnapshot, type IssueDetail, type IssueEventLog } from "./schemas/orchestrator.js";
import type { AgentRuntimeEvent } from "./schemas/events.js";
import type { RefreshResult } from "./rpc.js";
import { applyRuntimeEvent } from "./snapshot-reducer.js";

type Unsubscribe = () => void;
type Listener = () => void;
type EventListener = (event: AgentRuntimeEvent) => void;

export class RuntimeStream {
  #snapshot: RuntimeSnapshot | null = null;
  #status: SseStatus = "connecting";
  #snapshotListeners = new Set<Listener>();
  #statusListeners = new Set<Listener>();
  #eventListeners = new Set<EventListener>();
  #connection: SseConnection | null = null;
  #client: ReturnType<typeof makePlotClient>;
  #sseUrl: string;
  #resyncTimer: ReturnType<typeof setInterval> | null = null;
  #resyncInFlight = false;
  #closed = false;

  constructor(rpcBaseUrl: string, options?: { resyncIntervalMs?: number }) {
    this.#client = makePlotClient(rpcBaseUrl);
    this.#sseUrl = `${rpcBaseUrl.replace(/\/+$/, "")}/events`;

    this.#connection = connectSse(
      this.#sseUrl,
      (event) => this.#handleEvent(event),
      (status) => this.#handleStatus(status),
    );

    const interval = options?.resyncIntervalMs ?? 30_000;
    this.#resyncTimer = setInterval(() => void this.#resync(), interval);
  }

  // -- useSyncExternalStore contract: snapshot --

  subscribe = (cb: Listener): Unsubscribe => {
    this.#snapshotListeners.add(cb);
    return () => this.#snapshotListeners.delete(cb);
  };

  getSnapshot = (): RuntimeSnapshot | null => this.#snapshot;

  // -- useSyncExternalStore contract: status --

  subscribeStatus = (cb: Listener): Unsubscribe => {
    this.#statusListeners.add(cb);
    return () => this.#statusListeners.delete(cb);
  };

  getStatus = (): SseStatus => this.#status;

  // -- RPC pass-through --

  triggerRefresh = (): Promise<RefreshResult> => this.#client.triggerRefresh();

  getIssue = (identifier: string): Promise<IssueDetail> => this.#client.getIssue(identifier);

  getEventLog = (identifier: string): Promise<IssueEventLog> =>
    this.#client.getEventLog(identifier);

  onEvent = (cb: EventListener): Unsubscribe => {
    this.#eventListeners.add(cb);
    return () => this.#eventListeners.delete(cb);
  };

  // -- lifecycle --

  close(): void {
    this.#closed = true;
    this.#connection?.close();
    if (this.#resyncTimer) clearInterval(this.#resyncTimer);
  }

  // -- internals --

  #handleEvent(event: AgentRuntimeEvent): void {
    for (const cb of this.#eventListeners) cb(event);

    const result = applyRuntimeEvent(this.#snapshot, event);
    if (result.type === "resync") {
      void this.#resync();
      return;
    }

    this.#snapshot = result.snapshot;
    this.#emitSnapshot();
  }

  #handleStatus(status: SseStatus): void {
    this.#status = status;
    this.#emitStatus();

    if (status === "connected") {
      void this.#resync();
    }
  }

  async #resync(): Promise<void> {
    if (this.#resyncInFlight || this.#closed) return;
    this.#resyncInFlight = true;
    try {
      this.#snapshot = await this.#client.getState();
      this.#emitSnapshot();
    } catch {
      /* will retry on next event, reconnect, or interval */
    } finally {
      this.#resyncInFlight = false;
    }
  }

  #emitSnapshot(): void {
    for (const cb of this.#snapshotListeners) cb();
  }

  #emitStatus(): void {
    for (const cb of this.#statusListeners) cb();
  }
}
