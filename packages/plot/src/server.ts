import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/unstable/http";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Schedule, Stream } from "effect";
import type {
	HealthResponse,
	HealthCheckResult,
	JsonRpcRequest,
} from "@plot/sdk";
import { notification, response, rpcError, RpcErrorCode } from "@plot/sdk";
import { Orchestrator } from "./core/index.js";
import type { ServerConfig } from "./config.js";
import {
	makeAppLayer,
	makeLoggingLayer,
	makeOrchestratorLayer,
	makeStartupLayer,
} from "./runtime-builder.js";
import type { ResolvedPlugin } from "./runtime-builder.js";

export function makeServer(
	config: ServerConfig,
	resolvedPlugin: ResolvedPlugin,
) {
	const LoggingLive = makeLoggingLayer(config);
	const AppLayer = makeAppLayer(resolvedPlugin);
	const OrchestratorLive = makeOrchestratorLayer(resolvedPlugin);
	const StartupLive = makeStartupLayer(config, resolvedPlugin);

	const encoder = new TextEncoder();

	function sseFrame(data: string): Uint8Array {
		return encoder.encode(`event: message\ndata: ${data}\n\n`);
	}

	const SseRouteLive = HttpRouter.use(
		Effect.fn(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"GET",
				"/events",
				Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const url = new URL(req.url, "http://localhost");
					const focusIssueId = url.searchParams.get("focus");

					const initial = Stream.make(orchestrator.getSnapshot).pipe(
						Stream.mapEffect((get) => get),
					);

					const stateUpdates = Stream.concat(
						initial,
						orchestrator.snapshotStream,
					).pipe(
						Stream.map((snapshot) =>
							sseFrame(
								JSON.stringify(notification("state/update", { snapshot })),
							),
						),
					);

					const issueEvents = focusIssueId
						? orchestrator.eventStream.pipe(
								Stream.filter((e) => e.issueId === focusIssueId),
								Stream.map((event) =>
									sseFrame(
										JSON.stringify(
											notification("issue/event", {
												issueId: focusIssueId,
												event,
											}),
										),
									),
								),
							)
						: Stream.empty;

					const heartbeat = Stream.repeat(
						Stream.succeed(encoder.encode(": heartbeat\n\n")),
						Schedule.fixed("5 seconds"),
					);

					const allStreams = focusIssueId
						? Stream.merge(Stream.merge(stateUpdates, issueEvents), heartbeat)
						: Stream.merge(stateUpdates, heartbeat);

					return HttpServerResponse.stream(allStreams, {
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

	const startedAt = Date.now();

	const RpcRouteLive = HttpRouter.use(
		Effect.fn(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"POST",
				"/rpc",
				Effect.gen(function* () {
					const req = yield* HttpServerRequest.HttpServerRequest;
					const body = (yield* req.json) as unknown as JsonRpcRequest;

					switch (body.method) {
						case "health": {
							const snapshot = yield* orchestrator.getSnapshot;
							const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
							return yield* HttpServerResponse.json(
								response(body.id, {
									status: "pass" as const,
									version: process.env["PLOT_VERSION"] ?? "0.0.1",
									uptimeSeconds,
									agents: snapshot.running.length,
								}),
							);
						}
						case "refresh": {
							const result = yield* orchestrator.triggerRefresh;
							return yield* HttpServerResponse.json(
								response(body.id, { queued: result.queued }),
							);
						}
						case "focus": {
							const params = body.params as { issueId: string };
							const log = yield* orchestrator
								.getEventLog(params.issueId)
								.pipe(Effect.catch(() => Effect.succeed(null)));
							return yield* HttpServerResponse.json(
								response(body.id, { events: log?.events ?? [] }),
							);
						}
						case "unfocus": {
							return yield* HttpServerResponse.json(response(body.id, {}));
						}
						case "stop": {
							return yield* HttpServerResponse.json(response(body.id, {}));
						}
						default:
							return yield* HttpServerResponse.json(
								rpcError(
									body.id,
									RpcErrorCode.MethodNotFound,
									`Unknown method: ${body.method}`,
								),
							);
					}
				}).pipe(
					Effect.catch(() =>
						HttpServerResponse.json(
							rpcError(null, RpcErrorCode.InternalError, "Internal error"),
							{ status: 500 },
						),
					),
				),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const HealthLive = HttpRouter.use(
		Effect.fn(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"GET",
				"/health",
				Effect.gen(function* () {
					const snapshot = yield* orchestrator.getSnapshot;
					const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
					const version = process.env["PLOT_VERSION"] ?? "0.0.1";

					const healthResponse: HealthResponse = {
						status: "pass",
						version,
						description: "plot-ai orchestrator",
						checks: {
							"orchestrator:uptime": [
								{
									observedValue: uptimeSeconds,
									observedUnit: "s",
									status: "pass",
								} satisfies HealthCheckResult,
							],
							"orchestrator:agents": [
								{
									observedValue: snapshot.running.length,
									observedUnit: "count",
									status: "pass",
								} satisfies HealthCheckResult,
							],
						},
					};

					return yield* HttpServerResponse.json(healthResponse, {
						headers: {
							"Content-Type": "application/health+json",
							"Cache-Control": "no-cache",
						},
					});
				}).pipe(
					Effect.catch(() =>
						HttpServerResponse.json(
							{ status: "fail" } satisfies HealthResponse,
							{
								status: 503,
								headers: { "Content-Type": "application/health+json" },
							},
						),
					),
				),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const app = HttpRouter.serve(
		Layer.mergeAll(SseRouteLive, RpcRouteLive, HealthLive),
	).pipe(
		Layer.provide(BunHttpServer.layer({ port: config.port, idleTimeout: 120 })),
		Layer.provide(StartupLive),
		Layer.provide(LoggingLive),
		Layer.provide(AppLayer),
	);

	return app;
}
