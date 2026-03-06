declare const Bun: {
  env: Record<string, string | undefined>;
  argv: ReadonlyArray<string>;
  file: (path: string) => { exists: () => Promise<boolean> };
};

declare const process: { exit: (code: number) => never };
import { FileSystem, HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { BunContext, BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Effect, Layer, Logger, LogLevel, Schedule, Schema, Stream } from "effect";
import { AgentRuntimeEvent, PlotRpcs } from "@plot/shared";
import { Orchestrator } from "@plot/core";
import { makeLocalFsTracker, makeGithubTracker } from "@plot/tracker";
import { PiAgentLive } from "@plot/agent";
import { RpcHandlersLive } from "./rpc-handlers.js";
import { resolve, dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// cli arg parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  workflowPath: string;
  port: number;
  issuesDir: string;
  logFormat: string;
  logLevel: string;
  trackerKind: string;
  githubRepo: string;
}

const parseCli = (): CliArgs => {
  const args = Bun.argv.slice(2);
  let positional: string | undefined;
  let portFlag: string | undefined;
  let trackerFlag: string | undefined;
  let githubRepoFlag: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && i + 1 < args.length) {
      portFlag = args[++i];
    } else if (args[i]!.startsWith("--port=")) {
      portFlag = args[i]!.slice("--port=".length);
    } else if (args[i] === "--tracker" && i + 1 < args.length) {
      trackerFlag = args[++i];
    } else if (args[i]!.startsWith("--tracker=")) {
      trackerFlag = args[i]!.slice("--tracker=".length);
    } else if (args[i] === "--github-repo" && i + 1 < args.length) {
      githubRepoFlag = args[++i];
    } else if (args[i]!.startsWith("--github-repo=")) {
      githubRepoFlag = args[i]!.slice("--github-repo=".length);
    } else if (!args[i]!.startsWith("-")) {
      positional = args[i];
    }
  }

  const workflowPath = positional ?? Bun.env["PLOT_WORKFLOW"] ?? "./WORKFLOW.md";
  const port = portFlag ? parseInt(portFlag, 10) : parseInt(Bun.env["PLOT_PORT"] ?? "3000", 10);

  return {
    workflowPath,
    port,
    issuesDir: Bun.env["PLOT_ISSUES_DIR"] ?? "./issues",
    logFormat: Bun.env["PLOT_LOG_FORMAT"] ?? "pretty",
    logLevel: Bun.env["PLOT_LOG_LEVEL"] ?? "info",
    trackerKind: trackerFlag ?? Bun.env["PLOT_TRACKER_KIND"] ?? "local-fs",
    githubRepo: githubRepoFlag ?? Bun.env["PLOT_GITHUB_REPO"] ?? "",
  };
};

const cli = parseCli();

const workflowExists = await Bun.file(cli.workflowPath).exists();
if (!workflowExists) {
  console.error(`error: workflow file not found: ${cli.workflowPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

const parseLogLevel = (s: string): LogLevel.LogLevel => {
  switch (s.toLowerCase()) {
    case "debug":
      return LogLevel.Debug;
    case "info":
      return LogLevel.Info;
    case "warning":
      return LogLevel.Warning;
    case "error":
      return LogLevel.Error;
    case "none":
      return LogLevel.None;
    default:
      return LogLevel.Info;
  }
};

const LoggingLive = Layer.mergeAll(
  cli.logFormat === "json" ? Logger.json : Logger.pretty,
  Logger.minimumLogLevel(parseLogLevel(cli.logLevel)),
);

// ---------------------------------------------------------------------------
// layers
// ---------------------------------------------------------------------------

const TrackerLive = (() => {
  if (cli.trackerKind === "github") {
    return makeGithubTracker({
      repo: cli.githubRepo || undefined,
    });
  }
  return makeLocalFsTracker(cli.issuesDir).pipe(Layer.provide(BunContext.layer));
})();
const AppLayer = Layer.mergeAll(TrackerLive, PiAgentLive, BunContext.layer);
const OrchestratorLive = Orchestrator.Default.pipe(Layer.provide(AppLayer));

const RpcLayer = RpcServer.layer(PlotRpcs).pipe(
  Layer.provide(RpcHandlersLive),
  Layer.provide(OrchestratorLive),
);

const HttpProtocol = RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
);

const encoder = new TextEncoder();
const encodeEvent = Schema.encodeSync(AgentRuntimeEvent);

const SseRouteLive = HttpRouter.Default.use((router) =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator;
    yield* router.get(
      "/rpc/events",
      Effect.sync(() => {
        const events = Stream.fromPubSub(orchestrator.eventPubSub).pipe(
          Stream.map((event) => {
            const json = JSON.stringify(encodeEvent(event));
            return encoder.encode(`data: ${json}\n\n`);
          }),
        );
        const heartbeat = Stream.repeat(
          Effect.succeed(encoder.encode(": heartbeat\n\n")),
          Schedule.fixed("5 seconds"),
        );
        return HttpServerResponse.stream(Stream.merge(events, heartbeat), {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      }),
    );
  }),
).pipe(Layer.provide(OrchestratorLive));

const StartupLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator;
    yield* orchestrator.start(cli.workflowPath);
    yield* Effect.logInfo("server started").pipe(
      Effect.annotateLogs({
        component: "server",
        port: String(cli.port),
        issues_dir: cli.issuesDir,
        workflow: cli.workflowPath,
      }),
    );
  }),
).pipe(Layer.provide(OrchestratorLive));

const startedAt = Date.now();

const HealthzLive = HttpRouter.Default.use((router) =>
  router.get(
    "/healthz",
    Effect.flatMap(
      Effect.sync(() => ({ status: "ok" as const, uptime: Math.floor((Date.now() - startedAt) / 1000) })),
      (body) => HttpServerResponse.json(body),
    ),
  ),
);

const __serverDir = dirname(fileURLToPath(import.meta.url));
const webDistDir = resolve(__serverDir, "../../web/dist");

const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const StaticLive = HttpRouter.Default.use((router) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* router.get(
      "/*",
      Effect.gen(function* () {
        const req = yield* HttpServerRequest.HttpServerRequest;
        const url = new URL(req.url, "http://localhost");
        const pathname = url.pathname;

        if (pathname.startsWith("/rpc")) {
          return HttpServerResponse.empty({ status: 404 });
        }

        const filePath = join(webDistDir, pathname);
        const exists = yield* fs.exists(filePath).pipe(Effect.orElseSucceed(() => false));
        if (exists && pathname !== "/") {
          const ext = extname(filePath);
          const ct = contentTypes[ext] ?? "application/octet-stream";
          const content = yield* fs.readFile(filePath);
          return HttpServerResponse.uint8Array(content, { contentType: ct });
        }

        const indexPath = join(webDistDir, "index.html");
        const indexExists = yield* fs.exists(indexPath).pipe(Effect.orElseSucceed(() => false));
        if (indexExists) {
          const content = yield* fs.readFile(indexPath);
          return HttpServerResponse.uint8Array(content, { contentType: "text/html" });
        }

        return HttpServerResponse.empty({ status: 404 });
      }),
    );
  }),
).pipe(Layer.provide(BunContext.layer));

const Main = HttpRouter.Default.serve().pipe(
  Layer.provide(RpcLayer),
  Layer.provide(HttpProtocol),
  Layer.provide(SseRouteLive),
  Layer.provide(HealthzLive),
  Layer.provide(StaticLive),
  Layer.provide(BunHttpServer.layer({ port: cli.port, idleTimeout: 120 })),
  Layer.provide(StartupLive),
  Layer.provide(LoggingLive),
);

BunRuntime.runMain(Layer.launch(Main));
