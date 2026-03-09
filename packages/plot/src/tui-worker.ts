import { Console } from "node:console";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigProvider, Effect, ManagedRuntime, Schema, Stream } from "effect";
import { applyRuntimeEvent, RefreshResult, RuntimeSnapshot } from "@plot/sdk";
import { ObservabilityApi } from "./observability-service.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { makeObservabilityRuntime } from "./runtime-builder.js";

type StartMessage = { type: "start"; env: Record<string, string> };
type StopMessage = { type: "stop" };
type CallMessage = { type: "call"; id: number; method: "triggerRefresh" };
type WorkerMessage = StartMessage | StopMessage | CallMessage;

type ResponseMessage =
  | { type: "response"; id: number; ok: true; result: unknown }
  | { type: "response"; id: number; ok: false; error: string };

const encodeSnapshot = Schema.encodeSync(RuntimeSnapshot);
const encodeRefreshResult = Schema.encodeSync(RefreshResult);

let started = false;
let runtime: ManagedRuntime.ManagedRuntime<ObservabilityApi, never> | null = null;
let api: ObservabilityApi | null = null;
let currentSnapshot: RuntimeSnapshot | null = null;
let resyncTimer: ReturnType<typeof setInterval> | null = null;

const RESYNC_INTERVAL_MS = 30_000;

function postSnapshot(snapshot: RuntimeSnapshot) {
  self.postMessage({ type: "snapshot", snapshot: encodeSnapshot(snapshot) });
}

async function resync(): Promise<void> {
  if (!runtime || !api) return;
  try {
    currentSnapshot = await runtime.runPromise(api.getState);
    postSnapshot(currentSnapshot);
  } catch {
    /* will retry on next event or interval */
  }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === "stop") {
    void shutdown();
    return;
  }
  if (message.type === "call") {
    void handleCall(message);
    return;
  }
  if (started) {
    self.postMessage({ type: "error", error: "tui server worker already started" });
    return;
  }
  started = true;
  void boot(message.env);
};

async function boot(env: Record<string, string>) {
  try {
    redirectProcessOutput(env["PLOT_TUI_SERVER_LOG_PATH"]);
    const provider = ConfigProvider.fromMap(new Map(Object.entries(env)), { pathDelim: "_" });
    const config = await Effect.runPromise(ServerConfig.pipe(Effect.withConfigProvider(provider)));
    let content = "";
    try {
      content = readFileSync(config.workflowPath, "utf-8");
    } catch {}
    const workflowConfig = parseWorkflowFrontmatter(content);
    const resolved = new ResolvedConfig(workflowConfig, config.overrides);
    runtime = makeObservabilityRuntime(config, resolved);
    api = await runtime.runPromise(
      Effect.gen(function* () {
        return yield* ObservabilityApi;
      }),
    );

    currentSnapshot = await runtime.runPromise(api.getState);

    runtime.runFork(
      Stream.runForEach(api.eventStream, (event) =>
        Effect.sync(() => {
          const result = applyRuntimeEvent(currentSnapshot, event);
          if (result.type === "patched") {
            currentSnapshot = result.snapshot;
            postSnapshot(currentSnapshot);
          } else {
            void resync();
          }
        }),
      ),
    );

    resyncTimer = setInterval(() => void resync(), RESYNC_INTERVAL_MS);

    postSnapshot(currentSnapshot);
    self.postMessage({ type: "ready" });
  } catch (error) {
    self.postMessage({
      type: "error",
      error:
        error instanceof Error
          ? [error.message, error.stack].filter(Boolean).join("\n")
          : String(error),
    });
  }
}

async function handleCall(message: CallMessage) {
  if (!runtime || !api) {
    postResponse({
      type: "response",
      id: message.id,
      ok: false,
      error: "tui runtime is not ready",
    });
    return;
  }
  try {
    const result = encodeRefreshResult(await runtime.runPromise(api.triggerRefresh));
    postResponse({ type: "response", id: message.id, ok: true, result });
    await resync();
  } catch (error) {
    postResponse({
      type: "response",
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function shutdown() {
  if (resyncTimer) clearInterval(resyncTimer);
  if (runtime) await runtime.dispose();
  process.exit(0);
}

function postResponse(message: ResponseMessage) {
  self.postMessage(message);
}

function redirectProcessOutput(path?: string) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  const stream = createWriteStream(path, { flags: "a" });
  const write = (chunk: string | Uint8Array) => {
    stream.write(typeof chunk === "string" ? chunk : Buffer.from(chunk));
    return true;
  };
  process.stdout.write = write as typeof process.stdout.write;
  process.stderr.write = write as typeof process.stderr.write;
  const redirectedConsole = new Console({ stdout: process.stdout, stderr: process.stderr });
  console.log = redirectedConsole.log.bind(redirectedConsole);
  console.info = redirectedConsole.info.bind(redirectedConsole);
  console.warn = redirectedConsole.warn.bind(redirectedConsole);
  console.error = redirectedConsole.error.bind(redirectedConsole);
  console.debug = redirectedConsole.debug.bind(redirectedConsole);
}
