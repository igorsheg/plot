import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from "effect";
import { Orchestrator } from "./core/index.js";
import { makeLocalFsTracker, makeGithubTracker } from "./tracker/index.js";
import { PiAgentLive } from "./agent/index.js";
import type { ServerConfig } from "./config.js";
import { ObservabilityApi } from "./observability-service.js";

export function parseServerLogLevel(s: string): LogLevel.LogLevel {
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
}

export function makeLoggingLayer(config: ServerConfig) {
	return Layer.mergeAll(
		config.logFormat === "json" ? Logger.json : Logger.pretty,
		Logger.minimumLogLevel(parseServerLogLevel(config.logLevel)),
	);
}

export function makeTrackerLayer(config: ServerConfig) {
	if (config.trackerKind === "github") {
		return makeGithubTracker({
			repo: config.githubRepo || undefined,
		});
	}
	return makeLocalFsTracker(config.issuesDir).pipe(
		Layer.provide(BunContext.layer),
	);
}

export function makeAppLayer(config: ServerConfig) {
	return Layer.mergeAll(
		makeTrackerLayer(config),
		PiAgentLive,
		BunContext.layer,
	);
}

export function makeOrchestratorLayer(config: ServerConfig) {
	return Orchestrator.Default.pipe(Layer.provide(makeAppLayer(config)));
}

export function makeObservabilityLayer(config: ServerConfig) {
	return ObservabilityApi.Default.pipe(
		Layer.provide(makeOrchestratorLayer(config)),
	);
}

export function makeStartupLayer(config: ServerConfig) {
	return Layer.scopedDiscard(
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
	).pipe(Layer.provide(makeOrchestratorLayer(config)));
}

export function makeObservabilityRuntime(config: ServerConfig) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeObservabilityLayer(config),
			makeStartupLayer(config),
			makeLoggingLayer(config),
		) as Layer.Layer<ObservabilityApi, never, never>,
	);
}
