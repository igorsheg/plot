import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Schedule, Stream } from "effect";
import type { HealthResponse, HealthCheckResult } from "@plot/sdk";
import { Orchestrator } from "./core/index.js";
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

	const encoder = new TextEncoder();

	let nextId = 0;
	function sseFrame(event: string, data: string): Uint8Array {
		return encoder.encode(`id: ${nextId++}\nevent: ${event}\ndata: ${data}\n\n`);
	}

	const SseRouteLive = HttpRouter.use(
		Effect.fn(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"GET",
				"/events",
				Effect.sync(() => {
					const initial = Stream.make(orchestrator.getSnapshot).pipe(
						Stream.mapEffect((get) => get),
					);
					const snapshots = Stream.concat(initial, orchestrator.snapshotStream).pipe(
						Stream.map((s) => sseFrame("snapshot", JSON.stringify(s))),
					);
					const agents = orchestrator.eventStream.pipe(
						Stream.map((e) => sseFrame("agent", JSON.stringify(e))),
					);
					const heartbeat = Stream.repeat(
						Stream.succeed(encoder.encode(": heartbeat\n\n")),
						Schedule.fixed("5 seconds"),
					);
					return HttpServerResponse.stream(
						Stream.merge(Stream.merge(snapshots, agents), heartbeat),
						{
							contentType: "text/event-stream",
							headers: {
								"Cache-Control": "no-cache",
								"X-Accel-Buffering": "no",
								Connection: "keep-alive",
							},
						},
					);
				}),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const startedAt = Date.now();

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

					const response: HealthResponse = {
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

					return yield* HttpServerResponse.json(response, {
						headers: {
							"Content-Type": "application/health+json",
							"Cache-Control": "no-cache",
						},
					});
				}).pipe(
					Effect.catch(() =>
						HttpServerResponse.json(
							{ status: "fail" } satisfies HealthResponse,
							{ status: 503, headers: { "Content-Type": "application/health+json" } },
						),
					),
				),
			);
		}),
	).pipe(Layer.provide(OrchestratorLive));

	const app = HttpRouter.serve(Layer.mergeAll(SseRouteLive, HealthLive)).pipe(
		Layer.provide(BunHttpServer.layer({ port: config.port, idleTimeout: 120 })),
		Layer.provide(StartupLive),
		Layer.provide(LoggingLive),
		Layer.provide(AppLayer),
	);

	return app;
}
