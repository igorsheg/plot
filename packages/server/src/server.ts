import {
	FileSystem,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import {
	Effect,
	Layer,
	Logger,
	LogLevel,
	Schedule,
	Schema,
	Stream,
} from "effect";
import {
	AgentRuntimeEvent,
	IssueNotFound,
	OrchestratorUnavailable,
	PlotRpcs,
} from "@plot/contracts";
import { Orchestrator } from "@plot/core";
import { makeLocalFsTracker, makeGithubTracker } from "@plot/tracker";
import { PiAgentLive } from "@plot/agent";
import { ObservabilityApi } from "./observability-service.js";
import { RpcHandlersLive } from "./rpc-handlers.js";
import { join, extname } from "node:path";
import type { ServerConfig } from "./config.js";

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

export function makeServer(config: ServerConfig) {
	const LoggingLive = Layer.mergeAll(
		config.logFormat === "json" ? Logger.json : Logger.pretty,
		Logger.minimumLogLevel(parseLogLevel(config.logLevel)),
	);

	const TrackerLive = (() => {
		if (config.trackerKind === "github") {
			return makeGithubTracker({
				repo: config.githubRepo || undefined,
			});
		}
		return makeLocalFsTracker(config.issuesDir).pipe(
			Layer.provide(BunContext.layer),
		);
	})();

	const AppLayer = Layer.mergeAll(TrackerLive, PiAgentLive, BunContext.layer);
	const OrchestratorLive = Orchestrator.Default.pipe(Layer.provide(AppLayer));

	const ObservabilityLive = ObservabilityApi.Default.pipe(
		Layer.provide(OrchestratorLive),
	);

	const RpcLayer = RpcServer.layer(PlotRpcs).pipe(
		Layer.provide(RpcHandlersLive),
		Layer.provide(ObservabilityLive),
	);

	const HttpProtocol = RpcServer.layerProtocolHttp({ path: "/rpc" }).pipe(
		Layer.provide(RpcSerialization.layerNdjson),
	);

	const encoder = new TextEncoder();
	const encodeEvent = Schema.encodeSync(AgentRuntimeEvent);

	const eventStreamResponse = (api: ObservabilityApi) => {
		const events = api.eventStream.pipe(
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
	};

	const apiErrorResponse = (error: IssueNotFound | OrchestratorUnavailable) => {
		if (error._tag === "IssueNotFound") {
			return HttpServerResponse.json(
				{ error: { code: "issue_not_found", message: error.message } },
				{ status: 404 },
			);
		}

		return HttpServerResponse.json(
			{ error: { code: "orchestrator_unavailable", message: error.message } },
			{ status: 503 },
		);
	};

	const SseRouteLive = HttpRouter.Default.use((router) =>
		Effect.gen(function* () {
			const api = yield* ObservabilityApi;
			yield* router.get(
				"/rpc/events",
				Effect.sync(() => eventStreamResponse(api)),
			);
			yield* router.get(
				"/api/v1/events",
				Effect.sync(() => eventStreamResponse(api)),
			);
		}),
	).pipe(Layer.provide(ObservabilityLive));

	const StartupLive = Layer.scopedDiscard(
		Effect.gen(function* () {
			const orchestrator = yield* Orchestrator;
			yield* orchestrator.start(config.workflowPath);
			yield* Effect.logInfo("server started").pipe(
				Effect.annotateLogs({
					component: "server",
					port: String(config.port),
					issues_dir: config.issuesDir,
					workflow: config.workflowPath,
				}),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const startedAt = Date.now();

	const HealthzLive = HttpRouter.Default.use((router) =>
		router.get(
			"/healthz",
			Effect.flatMap(
				Effect.sync(() => ({
					status: "ok" as const,
					uptime: Math.floor((Date.now() - startedAt) / 1000),
				})),
				(body) => HttpServerResponse.json(body),
			),
		),
	);

	const ApiRoutesLive = HttpRouter.Default.use((router) =>
		Effect.gen(function* () {
			const api = yield* ObservabilityApi;

			yield* router.get(
				"/api/v1/health",
				HttpServerResponse.json({
					status: "ok",
					uptime: Math.floor((Date.now() - startedAt) / 1000),
				}),
			);

			yield* router.get(
				"/api/v1/state",
				api.getState.pipe(
					Effect.flatMap((body) => HttpServerResponse.json(body)),
					Effect.catchTag("OrchestratorUnavailable", apiErrorResponse),
				),
			);

			yield* router.post(
				"/api/v1/refresh",
				api.triggerRefresh.pipe(
					Effect.flatMap((body) =>
						HttpServerResponse.json(body, { status: 202 }),
					),
					Effect.catchTag("OrchestratorUnavailable", apiErrorResponse),
				),
			);

			yield* router.get(
				"/api/v1/issues/*",
				Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const url = new URL(req.url, "http://localhost");
					const identifier = decodeURIComponent(
						url.pathname.replace("/api/v1/issues/", ""),
					);
					return yield* api.getIssue(identifier).pipe(
						Effect.flatMap((body) => HttpServerResponse.json(body)),
						Effect.catchTag("IssueNotFound", apiErrorResponse),
						Effect.catchTag("OrchestratorUnavailable", apiErrorResponse),
					);
				}),
			);
		}),
	).pipe(Layer.provide(ObservabilityLive));

	const webDistDir = config.webDistDir;

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

					if (pathname.startsWith("/rpc") || pathname.startsWith("/api/")) {
						return HttpServerResponse.empty({ status: 404 });
					}

					const filePath = join(webDistDir, pathname);
					const exists = yield* fs
						.exists(filePath)
						.pipe(Effect.orElseSucceed(() => false));
					if (exists && pathname !== "/") {
						const ext = extname(filePath);
						const ct = contentTypes[ext] ?? "application/octet-stream";
						const content = yield* fs.readFile(filePath);
						return HttpServerResponse.uint8Array(content, { contentType: ct });
					}

					const indexPath = join(webDistDir, "index.html");
					const indexExists = yield* fs
						.exists(indexPath)
						.pipe(Effect.orElseSucceed(() => false));
					if (indexExists) {
						const content = yield* fs.readFile(indexPath);
						return HttpServerResponse.uint8Array(content, {
							contentType: "text/html",
						});
					}

					return HttpServerResponse.empty({ status: 404 });
				}),
			);
		}),
	).pipe(Layer.provide(BunContext.layer));

	let app = HttpRouter.Default.serve().pipe(
		Layer.provide(RpcLayer),
		Layer.provide(HttpProtocol),
		Layer.provide(SseRouteLive),
		Layer.provide(ApiRoutesLive),
		Layer.provide(HealthzLive),
		Layer.provide(BunHttpServer.layer({ port: config.port, idleTimeout: 120 })),
		Layer.provide(StartupLive),
		Layer.provide(LoggingLive),
		Layer.provide(AppLayer),
	);

	if (config.webEnabled) {
		app = app.pipe(Layer.provide(StaticLive));
	}

	return app;
}
