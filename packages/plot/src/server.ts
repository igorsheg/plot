import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Schedule, Schema, Stream } from "effect";
import { RuntimeSnapshot, AgentRuntimeEvent, HealthResponse, HealthCheckResult } from "@plot/sdk";
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
	const encodeSnapshot = Schema.encodeSync(RuntimeSnapshot);
	const encodeEvent = Schema.encodeSync(AgentRuntimeEvent);

	let nextId = 0;
	function sseFrame(event: string, data: string): Uint8Array {
		return encoder.encode(`id: ${nextId++}\nevent: ${event}\ndata: ${data}\n\n`);
	}

	const SseRouteLive = HttpRouter.use(
		Effect.fnUntraced(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"GET",
				"/events",
				Effect.sync(() => {
					const initial = Stream.make(orchestrator.getSnapshot).pipe(
						Stream.mapEffect((get) => get),
					);
					const snapshots = Stream.concat(initial, orchestrator.snapshotStream).pipe(
						Stream.map((s) => sseFrame("snapshot", JSON.stringify(encodeSnapshot(s)))),
					);
					const agents = orchestrator.eventStream.pipe(
						Stream.map((e) => sseFrame("agent", JSON.stringify(encodeEvent(e)))),
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
	const encodeHealth = Schema.encodeSync(HealthResponse);

	const HealthLive = HttpRouter.use(
		Effect.fnUntraced(function* (router) {
			const orchestrator = yield* Orchestrator;
			yield* router.add(
				"GET",
				"/health",
				Effect.gen(function* () {
					const snapshot = yield* orchestrator.getSnapshot;
					const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
					const version = process.env["PLOT_VERSION"] ?? "0.0.1";

					const response = new HealthResponse({
						status: "pass",
						version,
						description: "plot-ai orchestrator",
						checks: {
							"orchestrator:uptime": [
								new HealthCheckResult({
									observedValue: uptimeSeconds,
									observedUnit: "s",
									status: "pass",
								}),
							],
							"orchestrator:agents": [
								new HealthCheckResult({
									observedValue: snapshot.running.length,
									observedUnit: "count",
									status: "pass",
								}),
							],
						},
					});

					return yield* HttpServerResponse.json(encodeHealth(response), {
						headers: {
							"Content-Type": "application/health+json",
							"Cache-Control": "no-cache",
						},
					});
				}).pipe(
					Effect.catch(() =>
						HttpServerResponse.json(
							encodeHealth(new HealthResponse({ status: "fail" })),
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
