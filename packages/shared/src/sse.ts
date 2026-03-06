import type { AgentRuntimeEvent } from "./schemas/events.js";

export type SseStatus = "connected" | "connecting" | "reconnecting" | "disconnected";
export type SseEventHandler = (event: AgentRuntimeEvent) => void;
export type SseStatusHandler = (status: SseStatus) => void;

export interface SseConnection {
  close: () => void;
}

export function connectSse(
  url: string,
  onEvent: SseEventHandler,
  onStatus: SseStatusHandler,
): SseConnection {
  let closed = false;
  const controller = new AbortController();

  const readStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    decoder: TextDecoder,
    buffer = "",
  ): Promise<void> => {
    if (closed) return;

    const { done, value } = await reader.read();
    if (done || !value) return;

    const nextBuffer = buffer + decoder.decode(value, { stream: true });
    const lines = nextBuffer.split("\n");
    const remainder = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentRuntimeEvent);
      } catch (err) {
        if (typeof console !== "undefined") {
          console.warn("plot sse parse:", err instanceof Error ? err.message : String(err));
        }
      }
    }

    return readStream(reader, decoder, remainder);
  };

  const reconnect = () => {
    if (closed) return;
    onStatus("reconnecting");
    setTimeout(() => {
      void connect();
    }, 2000);
  };

  const connect = async (): Promise<void> => {
    if (closed) return;
    onStatus("connecting");
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE fetch failed: ${res.status}`);
      }
      onStatus("connected");
      await readStream(res.body.getReader(), new TextDecoder());
    } catch (err) {
      if (closed) return;
      if (typeof console !== "undefined") {
        console.warn("plot sse:", err instanceof Error ? err.message : String(err));
      }
    }

    reconnect();
  };

  void connect();
  return {
    close: () => {
      closed = true;
      controller.abort();
    },
  };
}
