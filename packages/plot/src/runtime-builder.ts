import { resolve as resolvePath, join as joinPath } from "node:path";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { classifyPluginKind } from "./core/plugin-kind.js";
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Logger, LogLevel, ManagedRuntime, References } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import {
	type TrackerPluginClient,
	type TrackerPluginDefinition,
	type TrackerIssue,
	type TrackerIssueState,
	type TrackerRunContextRaw,
	type TrackerPluginConfig,
	type TrackerError,
	buildRunContext,
	PluginAuthError,
	PluginRateLimitError,
	PluginNotFoundError,
	PluginValidationError,
	TrackerAuthError,
	TrackerNetworkError,
	TrackerNotFoundError,
	TrackerRateLimitError,
	TrackerValidationError,
	TrackerClient,
	TrackerRunContext,
	WorkpadSection,
	Issue,
	IssueStateEntry,
	BlockerRef,
} from "@plot/sdk";
import { PiAgentLive } from "./agent/index.js";
import type { ServerConfig } from "./config.js";
import { Orchestrator, OrchestratorLive, WorkspaceManagerLive } from "./core/index.js";

import { WorkflowLoader } from "./core/workflow-loader.js";
import { type ResolvedConfig } from "./core/config-service.js";
import { beadsTrackerPlugin, githubTrackerPlugin } from "./tracker/index.js";
import { PluginInitError } from "./core/errors.js";

export function parseServerLogLevel(s: string): LogLevel.LogLevel {
	switch (s.toLowerCase()) {
		case "debug":
			return "Debug";
		case "info":
			return "Info";
		case "warning":
			return "Warn";
		case "error":
			return "Error";
		case "none":
			return "None";
		default:
			return "Info";
	}
}

export function makeLoggingLayer(config: ServerConfig) {
	const logger = config.logFormat === "json" ? Logger.consoleJson : Logger.consolePretty();
	return Layer.mergeAll(
		Logger.layer([logger]),
		Layer.succeed(References.MinimumLogLevel, parseServerLogLevel(config.logLevel)),
		Layer.succeed(Logger.LogToStderr, true),
	);
}

export interface ResolvedPlugin {
	readonly trackerLayer: Layer.Layer<TrackerClient>;
}


function mapPluginError(error: unknown, operation: string): TrackerError {
	if (error instanceof PluginAuthError) return new TrackerAuthError({ message: error.message });
	if (error instanceof PluginRateLimitError)
		return new TrackerRateLimitError({
			message: error.message,
			retryAfterMs: error.retryAfterMs,
		});
	if (error instanceof PluginNotFoundError)
		return new TrackerNotFoundError({
			message: error.message,
			resourceId: error.resourceId,
		});
	if (error instanceof PluginValidationError)
		return new TrackerValidationError({
			message: error.message,
			field: error.field,
		});
	const message = error instanceof Error ? error.message : String(error);
	return new TrackerNetworkError({ message: `${operation}: ${message}` });
}


function normalizeIssue(plain: TrackerIssue): Issue {
	return new Issue({
		id: plain.id,
		identifier: plain.identifier,
		title: plain.title,
		description: plain.description ?? null,
		priority: plain.priority,
		state: plain.state,
		branchName: plain.branchName,
		url: plain.url ?? null,
		labels: Array.from(plain.labels),
		blockedBy: plain.blockedBy?.map(
			(b) =>
				new BlockerRef({
					id: b.id ?? null,
					identifier: b.identifier ?? null,
					state: b.state ?? null,
				}),
		),
		metadata: plain.metadata,
		autoMerge: plain.autoMerge,
		createdAt: plain.createdAt,
		updatedAt: plain.updatedAt,
	});
}

function normalizeIssueStateEntry(plain: TrackerIssueState): IssueStateEntry {
	return new IssueStateEntry({ id: plain.id, state: plain.state });
}

function normalizeRunContext(raw: TrackerRunContextRaw | null): TrackerRunContext | null {
	if (raw == null) return null;
	const built = buildRunContext(raw);
	if (built == null) return null;
	return new TrackerRunContext({
		raw: built.raw ?? null,
		promptContext: built.promptContext ?? null,
		workpad: built.workpad ?? null,
		reviewFeedback: built.reviewFeedback ?? null,
		workpadSections: (built.workpadSections ?? []).map((s) => new WorkpadSection(s)),
	});
}

function adaptTrackerClient(plain: TrackerPluginClient): Layer.Layer<TrackerClient> {
	return Layer.succeed(
		TrackerClient,
		TrackerClient.of({
			fetchCandidateIssues: (dispatchStates) =>
				Effect.tryPromise({
					try: () => plain.fetchCandidateIssues(dispatchStates),
					catch: (e) => mapPluginError(e, "fetchCandidateIssues"),
				}).pipe(Effect.map((issues) => issues.map(normalizeIssue))),
			fetchIssuesByStates: (states) =>
				Effect.tryPromise({
					try: () => plain.fetchIssuesByStates?.(states) ?? Promise.resolve([]),
					catch: (e) => mapPluginError(e, "fetchIssuesByStates"),
				}).pipe(Effect.map((issues) => issues.map(normalizeIssue))),
			fetchIssueStatesByIds: (ids) =>
				Effect.tryPromise({
					try: () => plain.fetchIssueStatesByIds?.(ids) ?? Promise.resolve([]),
					catch: (e) => mapPluginError(e, "fetchIssueStatesByIds"),
				}).pipe(Effect.map((entries) => entries.map(normalizeIssueStateEntry))),
			fetchRunContext: (issueId, state) =>
				Effect.tryPromise({
					try: () => plain.fetchRunContext?.(issueId, state) ?? Promise.resolve(null),
					catch: (e) => mapPluginError(e, "fetchRunContext"),
				}).pipe(Effect.map(normalizeRunContext)),
		}),
	);
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPluginDefinition = TrackerPluginDefinition<any>;

const builtinTrackers: Record<string, AnyPluginDefinition> = {
	beads: beadsTrackerPlugin,
	github: githubTrackerPlugin,
};

function buildPluginConfig(resolved: ResolvedConfig) {
	return {
		...resolved.trackerPluginConfig,
		kind: resolved.trackerKind,
		githubRepo: resolved.githubRepo || undefined,
	};
}

function syncGithubRepoEnv(resolved: ResolvedConfig) {
	if (resolved.githubRepo) {
		process.env["GITHUB_REPO"] = resolved.githubRepo;
		return;
	}
	delete process.env["GITHUB_REPO"];
}

function resolveDefinitionConfig(
	definition: AnyPluginDefinition,
	rawConfig: TrackerPluginConfig,
): Effect.Effect<unknown, PluginInitError> {
	if (!definition.validateConfig) return Effect.succeed(rawConfig as unknown);
	return Effect.tryPromise({
		try: () => Promise.resolve(definition.validateConfig!(rawConfig)),
		catch: (error) =>
			new PluginInitError({
				pluginName: definition.name,
				message: error instanceof Error ? error.message : String(error),
				phase: "config",
				retryable: false,
			}),
	});
}

function makeResolvedPlugin(
	definition: AnyPluginDefinition,
	config: unknown,
): Effect.Effect<ResolvedPlugin, PluginInitError> {
	return Effect.tryPromise({
		try: () => Promise.resolve(definition.factory(config)),
		catch: (error) =>
			new PluginInitError({
				pluginName: definition.name,
				message: error instanceof Error ? error.message : String(error),
				phase: "factory",
				retryable: true,
			}),
	}).pipe(
		Effect.map((plain) => ({
			trackerLayer: adaptTrackerClient(plain),
		})),
	);
}

const PLUGIN_CACHE_DIR = joinPath(homedir(), ".plot", "plugins");

function detectNpmRegistry(): string | null {
	try {
		const output = execSync("npm config get registry", { stdio: "pipe", timeout: 5_000 }).toString().trim();
		if (output && output !== "undefined" && !output.includes("registry.npmjs.org")) return output;
	} catch { /* ignore */ }
	try {
		const yarnrc = joinPath(process.cwd(), ".yarnrc.yml");
		if (existsSync(yarnrc)) {
			const content = require("node:fs").readFileSync(yarnrc, "utf-8") as string;
			const match = /npmRegistryServer:\s*"?([^"\n]+)"?/.exec(content);
			if (match?.[1] && !match[1].includes("registry.npmjs.org")) return match[1];
		}
	} catch { /* ignore */ }
	return null;
}

/**
 * Resolve an npm package plugin by installing it to a persistent cache directory.
 * Detects the npm registry from the consumer's CWD (.npmrc, .yarnrc.yml) so
 * private registries work without hardcoding. Falls back to bun's default (npmjs.org).
 *
 * Cached by package name hash — subsequent calls reuse the existing install.
 * Returns the absolute path to the package's main entry point.
 */
function resolveNpmPlugin(packageName: string, options?: { refresh?: boolean }): Effect.Effect<string, PluginInitError> {
	return Effect.tryPromise({
		try: async () => {
			const hash = createHash("sha256").update(packageName).digest("hex").slice(0, 12);
			const cacheDir = joinPath(PLUGIN_CACHE_DIR, hash);
			const markerPath = joinPath(cacheDir, "node_modules", ...packageName.split("/"));

			if (options?.refresh || !existsSync(markerPath)) {
				mkdirSync(cacheDir, { recursive: true });
				writeFileSync(joinPath(cacheDir, "package.json"), '{"private":true}');
				const registry = detectNpmRegistry();
				const registryFlag = registry ? ` --registry ${registry}` : "";
				execSync(`bun add ${packageName}${registryFlag}`, {
					cwd: cacheDir,
					stdio: "pipe",
					timeout: 30_000,
				});
			}

			const pkgJsonPath = joinPath(markerPath, "package.json");
			const pkgJson = JSON.parse(await Bun.file(pkgJsonPath).text()) as {
				main?: string;
				exports?: Record<string, unknown> | string;
			};

			let entrypoint = "dist/index.js";
			if (typeof pkgJson.exports === "string") {
				entrypoint = pkgJson.exports;
			} else if (pkgJson.exports?.["."] != null) {
				const dotExport = pkgJson.exports["."];
				if (typeof dotExport === "string") entrypoint = dotExport;
				else if (typeof dotExport === "object" && dotExport !== null) {
					const rec = dotExport as Record<string, string>;
					entrypoint = rec["default"] ?? rec["import"] ?? rec["require"] ?? entrypoint;
				}
			} else if (pkgJson.main) {
				entrypoint = pkgJson.main;
			}

			return resolvePath(markerPath, entrypoint);
		},
		catch: (cause) =>
			new PluginInitError({
				pluginName: packageName,
				message: cause instanceof Error ? cause.message : String(cause),
				phase: "resolve",
				retryable: true,
			}),
	});
}

export interface ResolvePluginOptions {
	readonly refreshPlugins?: boolean;
}

export function resolvePlugin(resolved: ResolvedConfig, options?: ResolvePluginOptions): Effect.Effect<ResolvedPlugin, PluginInitError> {
	syncGithubRepoEnv(resolved);
	const rawConfig = buildPluginConfig(resolved);
	const builtin = builtinTrackers[resolved.trackerKind];

	if (builtin) {
		return resolveDefinitionConfig(builtin, rawConfig).pipe(
			Effect.flatMap((config) => makeResolvedPlugin(builtin, config)),
		);
	}

	return Effect.gen(function* () {
		const kind = resolved.trackerKind;
		const pluginKind = classifyPluginKind(kind, process.cwd());
		const resolvedPath = pluginKind.type === "local"
			? pluginKind.specifier
			: yield* resolveNpmPlugin(pluginKind.specifier, { refresh: options?.refreshPlugins });
		const mod = yield* Effect.tryPromise({
			try: () => import(resolvedPath) as Promise<{ default?: AnyPluginDefinition }>,
			catch: (cause) =>
				new PluginInitError({
					pluginName: kind,
					message: cause instanceof Error ? cause.message : String(cause),
					phase: "load",
					retryable: false,
				}),
		});
		const definition = mod.default;
		if (
			!definition ||
			typeof definition !== "object" ||
			typeof definition.name !== "string" ||
			typeof definition.factory !== "function"
		) {
			return yield* new PluginInitError({
				pluginName: kind,
				message: "does not export a valid default tracker plugin definition",
				phase: "load",
				retryable: false,
			});
		}

		const config = yield* resolveDefinitionConfig(definition, rawConfig);
		return yield* makeResolvedPlugin(definition, config);
	});
}

export function makeAppLayer(resolvedPlugin: ResolvedPlugin) {
	const platformDeps = BunServices.layer;
	return Layer.mergeAll(
		AtomRegistry.layer,
		resolvedPlugin.trackerLayer,
		PiAgentLive,
		platformDeps,
		WorkflowLoader.layer.pipe(Layer.provide(platformDeps)),
		WorkspaceManagerLive.pipe(Layer.provide(platformDeps)),
	);
}

export function makeOrchestratorLayer(resolvedPlugin: ResolvedPlugin) {
	return OrchestratorLive.pipe(Layer.provide(makeAppLayer(resolvedPlugin)));
}

export function makeStartupLayer(config: ServerConfig, resolvedPlugin: ResolvedPlugin) {
	return Layer.effectDiscard(
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

export function makeOrchestratorRuntime(config: ServerConfig, resolvedPlugin: ResolvedPlugin) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeOrchestratorLayer(resolvedPlugin),
			makeStartupLayer(config, resolvedPlugin),
			makeLoggingLayer(config),
		),
	);
}
