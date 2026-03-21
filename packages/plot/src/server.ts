import { FileSystem } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { BunServices, BunHttpServer } from "@effect/platform-bun";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { Effect, Layer, Schedule, Schema, Stream } from "effect";
import { RuntimeSnapshot, PlotRpcs } from "@plot/sdk";
import { Orchestrator } from "./core/index.js";
import { join, extname } from "node:path";
import type { ServerConfig } from "./config.js";
import {
	makeAppLayer,
	makeLoggingLayer,
	makeOrchestratorLayer,
	makeStartupLayer,
} from "./runtime-builder.js";
import type { ResolvedPlugin } from "./runtime-builder.js";

export function makeServer(config: ServerConfig, resolvedPlugin: ResolvedPlugin) {
	const LoggingLive = makeLoggingLayer(config);
	const AppLayer = makeAppLayer(resolvedPlugin);
	const OrchestratorLive = makeOrchestratorLayer(resolvedPlugin);
	const StartupLive = makeStartupLayer(config, resolvedPlugin);

	const RpcHandlersLive = PlotRpcs.toLayer(
		Effect.gen(function* () {
			const orchestrator = yield* Orchestrator;
			return {
				GetEventLog: ({ identifier }) => orchestrator.getEventLog(identifier),
				TriggerRefresh: () => orchestrator.triggerRefresh,
			};
		}),
	);

	const RpcRouteLive = HttpRouter.use(
		Effect.fnUntraced(function* (router) {
			const handler = yield* RpcServer.toHttpEffect(PlotRpcs);
			yield* router.add("POST", "/rpc", handler);
		}),
	).pipe(
		Layer.provide(RpcHandlersLive),
		Layer.provide(OrchestratorLive),
		Layer.provide(RpcSerialization.layerNdjson),
	);

	const encoder = new TextEncoder();
	const encodeSnapshot = Schema.encodeSync(RuntimeSnapshot);

	const SseRouteLive = HttpRouter.use(
		Effect.fnUntraced(function* (router) {
			const orchestrator = yield* Orchestrator;
			const initial = Stream.make(orchestrator.getSnapshot).pipe(Stream.mapEffect((get) => get));
			const changes = orchestrator.snapshotStream;
			const snapshots = Stream.concat(initial, changes).pipe(
				Stream.map((snapshot) => {
					const json = JSON.stringify(encodeSnapshot(snapshot));
					return encoder.encode(`data: ${json}\n\n`);
				}),
			);
			const heartbeat = Stream.repeat(
				Stream.succeed(encoder.encode(": heartbeat\n\n")),
				Schedule.fixed("5 seconds"),
			);
			yield* router.add(
				"GET",
				"/rpc/events",
				HttpServerResponse.stream(Stream.merge(snapshots, heartbeat), {
					contentType: "text/event-stream",
					headers: {
						"Cache-Control": "no-cache",
						"X-Accel-Buffering": "no",
						Connection: "keep-alive",
					},
				}),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const startedAt = Date.now();

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

	const StaticLive = HttpRouter.use(
		Effect.fnUntraced(function* (router) {
			const fs = yield* FileSystem.FileSystem;

			yield* router.add(
				"GET",
				"/*",
				Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const url = new URL(req.url, "http://localhost");
					const pathname = url.pathname;

					if (
						pathname.startsWith("/rpc") ||
						pathname.startsWith("/api/") ||
						pathname === "/healthz"
					) {
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
						return HttpServerResponse.uint8Array(content, {
							contentType: "text/html",
						});
					}

					return HttpServerResponse.empty({ status: 404 });
				}).pipe(
					Effect.catchTag("PlatformError", () =>
						Effect.succeed(HttpServerResponse.empty({ status: 500 })),
					),
				),
			);
		}),
	).pipe(Layer.provide(BunServices.layer));

	const HealthzLive = HttpRouter.use((router) =>
		router.add(
			"GET",
			"/healthz",
			HttpServerResponse.json({
				status: "ok" as const,
				uptime: Math.floor((Date.now() - startedAt) / 1000),
			}),
		),
	);

	let routeLayers = Layer.mergeAll(SseRouteLive, RpcRouteLive, HealthzLive);
	if (config.webEnabled) {
		routeLayers = Layer.mergeAll(routeLayers, StaticLive);
	}

	const app = HttpRouter.serve(routeLayers).pipe(
		Layer.provide(BunHttpServer.layer({ port: config.port, idleTimeout: 120 })),
		Layer.provide(StartupLive),
		Layer.provide(LoggingLive),
		Layer.provide(AppLayer),
	);

	return app;
}
