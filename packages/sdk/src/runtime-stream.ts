import { connectSse, type SseStatus, type SseConnection } from "./sse.js";
import { makePlotClient } from "./client.js";
import {
  LiveSession,
  RunningEntry,
  RuntimeSnapshot,
  ToolExecution,
  type IssueDetail,
  type IssueEventLog,
} from "./schemas/orchestrator.js";
import type { AgentRuntimeEvent } from "./schemas/events.js";
import type { RefreshResult } from "./rpc.js";

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

    if (!this.#snapshot) {
      void this.#resync();
      return;
    }

    const idx = this.#snapshot.running.findIndex((r) => r.issueId === event.issueId);

    if (idx === -1) {
      void this.#resync();
      return;
    }

    this.#snapshot = this.#patchSnapshot(this.#snapshot, idx, event);
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

  #patchSnapshot(
    snapshot: RuntimeSnapshot,
    idx: number,
    event: AgentRuntimeEvent,
  ): RuntimeSnapshot {
    const entry = snapshot.running[idx]!;
    const session = entry.session;

    let lastMessage = session.lastMessage;
    if (event.message && event.event !== "notification") {
      lastMessage = event.message;
    } else if (event.event === "notification" && event.message) {
      lastMessage = ((lastMessage ?? "") + event.message).slice(-200);
    }

    const shouldIncrementTurn = event.event === "turn_end";

    let phase = session.phase;
    let activeTools = session.activeTools;
    let lastAssistantMessage = session.lastAssistantMessage;

    switch (event.event) {
      case "message_start":
      case "message_update":
        phase = "thinking";
        break;
      case "message_end":
        if (event.message) lastAssistantMessage = event.message;
        phase = "idle";
        break;
      case "tool_execution_start":
        if (event.toolCallId && event.toolName) {
          activeTools = [
            ...activeTools,
            new ToolExecution({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
            }),
          ];
        }
        phase = "tool_execution";
        break;
      case "tool_execution_end":
        if (event.toolCallId) {
          activeTools = activeTools.filter((t) => t.toolCallId !== event.toolCallId);
        }
        phase = activeTools.length > 0 ? "tool_execution" : "idle";
        break;
      case "turn_start":
        phase = "thinking";
        break;
      case "turn_end":
        phase = "idle";
        activeTools = [];
        break;
      case "auto_compaction_start":
        phase = "compacting";
        break;
      case "auto_compaction_end":
        phase = "idle";
        break;
      case "auto_retry_start":
        phase = "retrying";
        break;
      case "auto_retry_end":
        phase = "idle";
        break;
    }

    const newSession = new LiveSession({
      sessionId: session.sessionId,
      threadId: session.threadId,
      turnId: session.turnId,
      agentPid: session.agentPid,
      lastEvent: event.event,
      lastEventAt: event.timestamp,
      lastMessage,
      inputTokens: event.usage?.inputTokens ?? session.inputTokens,
      outputTokens: event.usage?.outputTokens ?? session.outputTokens,
      totalTokens: event.usage?.totalTokens ?? session.totalTokens,
      turnCount: shouldIncrementTurn ? session.turnCount + 1 : session.turnCount,
      phase,
      activeTools,
      lastAssistantMessage,
    });

    const newEntry = new RunningEntry({
      issueId: entry.issueId,
      issueIdentifier: entry.issueIdentifier,
      state: entry.state,
      startedAt: entry.startedAt,
      workspacePath: entry.workspacePath,
      session: newSession,
    });

    const newRunning = [...snapshot.running];
    newRunning[idx] = newEntry;

    return new RuntimeSnapshot({
      generatedAt: snapshot.generatedAt,
      counts: snapshot.counts,
      running: newRunning,
      retrying: snapshot.retrying,
      codexTotals: snapshot.codexTotals,
      observability: snapshot.observability,
      rateLimits: snapshot.rateLimits,
    });
  }

  #emitSnapshot(): void {
    for (const cb of this.#snapshotListeners) cb();
  }

  #emitStatus(): void {
    for (const cb of this.#statusListeners) cb();
  }
}
