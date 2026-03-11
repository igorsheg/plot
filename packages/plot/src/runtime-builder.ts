import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from "effect";
import { Orchestrator } from "./core/index.js";
import { githubTrackerPlugin } from "./tracker/index.js";
import type { TrackerPlugin } from "@plot/sdk";
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

const builtinTrackers: Record<string, TrackerPlugin> = {
	github: githubTrackerPlugin,
};

function buildPluginConfig(resolved: ResolvedConfig) {
	return {
		...resolved.trackerPluginConfig,
		kind: resolved.trackerKind,
		githubRepo: resolved.githubRepo || undefined,
	};
}

function resolvePlugin(kind: string): Effect.Effect<TrackerPlugin> {
	const builtin = builtinTrackers[kind];
	if (builtin) return Effect.succeed(builtin);

	return Effect.gen(function* () {
		const mod = yield* Effect.tryPromise({
			try: () => import(kind) as Promise<{ default?: TrackerPlugin }>,
			catch: (cause) =>
				new Error(
					`Failed to load tracker plugin "${kind}": ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		}).pipe(Effect.catchAll((e) => Effect.die(e)));
		const plugin = mod.default;
		if (!plugin || typeof plugin.factory !== "function") {
			return yield* Effect.die(
				new Error(
					`Tracker plugin "${kind}" does not export a valid default TrackerPlugin`,
				),
			);
		}
		return plugin;
	});
}

export function makeTrackerLayer(resolved: ResolvedConfig) {
	return Layer.unwrapEffect(
		resolvePlugin(resolved.trackerKind).pipe(
			Effect.map((plugin) => {
				resolved.trackerSkillPaths = plugin.skillPaths ?? [];
				return plugin.factory(buildPluginConfig(resolved));
			}),
		),
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

export function makeStartupLayer(
	config: ServerConfig,
	resolved: ResolvedConfig,
) {
	return Layer.scopedDiscard(
		Effect.gen(function* () {
			const orchestrator = yield* Orchestrator;
			yield* orchestrator.start(config.workflowPath);
			yield* Effect.logInfo("server started").pipe(
				Effect.annotateLogs({
					component: "server",
					port: String(config.port),
					workflow: config.workflowPath,
				}),
			);
		}),
	).pipe(Layer.provide(makeOrchestratorLayer(resolved)));
}

export function makeObservabilityRuntime(
	config: ServerConfig,
	resolved: ResolvedConfig,
) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeObservabilityLayer(resolved),
			makeStartupLayer(config, resolved),
			makeLoggingLayer(config),
		) as Layer.Layer<ObservabilityApi, never, never>,
	);
}
