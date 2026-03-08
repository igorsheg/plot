import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from "effect";
import { Orchestrator } from "./core/index.js";
import { makeLocalFsTracker, makeGithubTracker } from "./tracker/index.js";
import { PiAgentLive } from "./agent/index.js";
import type { ServerConfig } from "./config.js";
import { type ResolvedConfig } from "./core/config-service.js";
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

export function makeTrackerLayer(resolved: ResolvedConfig) {
	if (resolved.trackerKind === "github") {
		return makeGithubTracker({
			repo: resolved.githubRepo || undefined,
		});
	}
	return makeLocalFsTracker(resolved.issuesDir).pipe(
		Layer.provide(BunContext.layer),
	);
}

export function makeAppLayer(resolved: ResolvedConfig) {
	return Layer.mergeAll(
		makeTrackerLayer(resolved),
		PiAgentLive,
		BunContext.layer,
	);
}

export function makeOrchestratorLayer(resolved: ResolvedConfig) {
	return Orchestrator.Default.pipe(Layer.provide(makeAppLayer(resolved)));
}

export function makeObservabilityLayer(resolved: ResolvedConfig) {
	return ObservabilityApi.Default.pipe(
		Layer.provide(makeOrchestratorLayer(resolved)),
	);
}

export function makeStartupLayer(config: ServerConfig, resolved: ResolvedConfig) {
	return Layer.scopedDiscard(
		Effect.gen(function* () {
			const orchestrator = yield* Orchestrator;
			yield* orchestrator.start(config.workflowPath);
			yield* Effect.logInfo("server started").pipe(
				Effect.annotateLogs({
					component: "server",
					port: String(config.port),
					issues_dir: resolved.issuesDir,
					workflow: config.workflowPath,
				}),
			);
		}),
	).pipe(Layer.provide(makeOrchestratorLayer(resolved)));
}

export function makeObservabilityRuntime(config: ServerConfig, resolved: ResolvedConfig) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeObservabilityLayer(resolved),
			makeStartupLayer(config, resolved),
			makeLoggingLayer(config),
		) as Layer.Layer<ObservabilityApi, never, never>,
	);
}
