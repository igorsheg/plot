import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime } from "effect";
import type {
	PluginToolDefinition,
	TrackerPlugin,
	TrackerPluginHooks,
	TrackerClient,
} from "@plot/sdk";
import { PiAgentLive } from "./agent/index.js";
import type { ServerConfig } from "./config.js";
import { Orchestrator } from "./core/index.js";
import { PluginContext } from "./core/plugin-context.js";
import { type ResolvedConfig } from "./core/config-service.js";
import { ObservabilityApi } from "./observability-service.js";
import { githubTrackerPlugin } from "./tracker/index.js";

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

export interface ResolvedPlugin {
	readonly name: string;
	readonly trackerLayer: Layer.Layer<TrackerClient>;
	readonly skillPaths: ReadonlyArray<string>;
	readonly tools: ReadonlyArray<PluginToolDefinition>;
	readonly hooks: TrackerPluginHooks | undefined;
}

const builtinTrackers: Record<
	string,
	{ readonly plugin: TrackerPlugin; readonly moduleDir: string }
> = {
	github: {
		plugin: githubTrackerPlugin,
		moduleDir: join(
			dirname(fileURLToPath(import.meta.url)),
			"tracker",
			"github",
		),
	},
};

function buildPluginConfig(resolved: ResolvedConfig) {
	return {
		...resolved.trackerPluginConfig,
		kind: resolved.trackerKind,
		githubRepo: resolved.githubRepo || undefined,
	};
}

function discoverSkillPaths(moduleDir: string): ReadonlyArray<string> {
	const skillsDir = join(moduleDir, "skills");
	if (!existsSync(skillsDir)) return [];

	try {
		return readdirSync(skillsDir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(skillsDir, entry.name))
			.filter((dir) => existsSync(join(dir, "SKILL.md")));
	} catch {
		return [];
	}
}

function makeResolvedPlugin(
	plugin: TrackerPlugin,
	config: unknown,
	moduleDir?: string,
): Effect.Effect<ResolvedPlugin> {
	const autoSkillPaths = moduleDir ? discoverSkillPaths(moduleDir) : [];
	const explicitSkillPaths = plugin.skillPaths ?? [];

	return plugin.buildInstance(config).pipe(
		Effect.map((instance) => ({
			name: plugin.name,
			trackerLayer: instance.trackerLayer,
			skillPaths: [...new Set([...autoSkillPaths, ...explicitSkillPaths])],
			tools: instance.tools,
			hooks: instance.hooks,
		})),
	);
}

export function resolvePlugin(
	resolved: ResolvedConfig,
): Effect.Effect<ResolvedPlugin> {
	const rawConfig = buildPluginConfig(resolved);
	const builtin = builtinTrackers[resolved.trackerKind];

	if (builtin) {
		return builtin.plugin
			.resolveConfig(rawConfig)
			.pipe(
				Effect.flatMap((config) =>
					makeResolvedPlugin(builtin.plugin, config, builtin.moduleDir),
				),
			);
	}

	return Effect.gen(function* () {
		const kind = resolved.trackerKind;
		const mod = yield* Effect.tryPromise({
			try: () => import(kind) as Promise<{ default?: TrackerPlugin }>,
			catch: (cause) =>
				new Error(
					`Failed to load tracker plugin "${kind}": ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		}).pipe(Effect.orDie);
		const plugin = mod.default;
		if (
			!plugin ||
			typeof plugin !== "object" ||
			typeof plugin.name !== "string" ||
			typeof plugin.resolveConfig !== "function" ||
			typeof plugin.buildInstance !== "function"
		) {
			return yield* Effect.die(
				new Error(
					`Tracker plugin "${kind}" does not export a valid default tracker plugin (expected defineTrackerPlugin() result)`,
				),
			);
		}

		const config = yield* plugin.resolveConfig(rawConfig);
		const moduleDir =
			kind.startsWith("./") || kind.startsWith("../") || kind.startsWith("/")
				? dirname(resolve(kind))
				: undefined;

		return yield* makeResolvedPlugin(plugin, config, moduleDir);
	});
}

export function makeTrackerLayer(resolvedPlugin: ResolvedPlugin) {
	return resolvedPlugin.trackerLayer;
}

export function makeAppLayer(resolvedPlugin: ResolvedPlugin) {
	return Layer.mergeAll(
		makeTrackerLayer(resolvedPlugin),
		PiAgentLive,
		BunContext.layer,
		Layer.succeed(PluginContext, {
			skillPaths: resolvedPlugin.skillPaths,
			tools: resolvedPlugin.tools,
			hooks: resolvedPlugin.hooks,
		}),
	);
}

export function makeOrchestratorLayer(resolvedPlugin: ResolvedPlugin) {
	return Orchestrator.Default.pipe(Layer.provide(makeAppLayer(resolvedPlugin)));
}

export function makeObservabilityLayer(resolvedPlugin: ResolvedPlugin) {
	return ObservabilityApi.Default.pipe(
		Layer.provide(makeOrchestratorLayer(resolvedPlugin)),
	);
}

export function makeStartupLayer(
	config: ServerConfig,
	resolvedPlugin: ResolvedPlugin,
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
	).pipe(Layer.provide(makeOrchestratorLayer(resolvedPlugin)));
}

export function makeObservabilityRuntime(
	config: ServerConfig,
	resolvedPlugin: ResolvedPlugin,
) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeObservabilityLayer(resolvedPlugin),
			makeStartupLayer(config, resolvedPlugin),
			makeLoggingLayer(config),
		) as Layer.Layer<ObservabilityApi, never, never>,
	);
}
