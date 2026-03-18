import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BunServices } from "@effect/platform-bun";
import {
	DateTime,
	Effect,
	Layer,
	Logger,
	LogLevel,
	ManagedRuntime,
	References,
} from "effect";
import {
	type PlainTrackerClient,
	type TrackerPluginDefinition,
	type IssueLike,
	type IssueStateEntryLike,
	type TrackerRunContextLike,
	type TrackerPluginConfig,
	type TrackerError,
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
import { Orchestrator } from "./core/index.js";
import { PluginContext } from "./core/plugin-context.js";
import { type ResolvedConfig } from "./core/config-service.js";
import { ObservabilityApi } from "./observability-service.js";
import { beadsTrackerPlugin, githubTrackerPlugin } from "./tracker/index.js";

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
	const logger =
		config.logFormat === "json" ? Logger.consoleJson : Logger.consolePretty();
	return Layer.mergeAll(
		Logger.layer([logger]),
		Layer.succeed(References.MinimumLogLevel, parseServerLogLevel(config.logLevel)),
	);
}

export interface ResolvedPlugin {
	readonly name: string;
	readonly trackerLayer: Layer.Layer<TrackerClient>;
	readonly skillPaths: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Adaptation: PlainTrackerClient → Layer<TrackerClient>
// ---------------------------------------------------------------------------

function mapPluginError(error: unknown, operation: string): TrackerError {
	if (error instanceof PluginAuthError)
		return new TrackerAuthError({ message: error.message });
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

function toDateTime(
	value: Date | string | null | undefined,
): DateTime.Utc | null {
	if (value == null) return null;
	const date = typeof value === "string" ? new Date(value) : value;
	return DateTime.fromDateUnsafe(date);
}

function normalizeIssue(plain: IssueLike): Issue {
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
		createdAt: toDateTime(plain.createdAt),
		updatedAt: toDateTime(plain.updatedAt),
	});
}

function normalizeIssueStateEntry(plain: IssueStateEntryLike): IssueStateEntry {
	return new IssueStateEntry({ id: plain.id, state: plain.state });
}

function normalizeRunContext(
	plain: TrackerRunContextLike | null,
): TrackerRunContext | null {
	if (plain == null) return null;
	return new TrackerRunContext({
		raw: plain.raw ?? null,
		promptContext: plain.promptContext ?? null,
		workpad: plain.workpad ?? null,
		reviewFeedback: plain.reviewFeedback ?? null,
		workpadSections: (plain.workpadSections ?? []).map(
			(s) => new WorkpadSection(s),
		),
	});
}

function adaptTrackerClient(
	plain: PlainTrackerClient,
): Layer.Layer<TrackerClient> {
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
					try: () =>
						plain.fetchRunContext?.(issueId, state) ?? Promise.resolve(null),
					catch: (e) => mapPluginError(e, "fetchRunContext"),
				}).pipe(Effect.map(normalizeRunContext)),
		}),
	);
}

// ---------------------------------------------------------------------------
// Plugin resolution
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPluginDefinition = TrackerPluginDefinition<any>;

const builtinTrackers: Record<
	string,
	{
		readonly definition: AnyPluginDefinition;
		readonly moduleDir: string;
	}
> = {
	beads: {
		definition: beadsTrackerPlugin,
		moduleDir: join(
			dirname(fileURLToPath(import.meta.url)),
			"tracker",
			"beads",
		),
	},
	github: {
		definition: githubTrackerPlugin,
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

function syncGithubRepoEnv(resolved: ResolvedConfig) {
	if (resolved.githubRepo) {
		process.env["GITHUB_REPO"] = resolved.githubRepo;
		return;
	}
	delete process.env["GITHUB_REPO"];
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

function resolveDefinitionConfig(
	definition: AnyPluginDefinition,
	rawConfig: TrackerPluginConfig,
): Effect.Effect<unknown> {
	if (!definition.validateConfig) return Effect.succeed(rawConfig as unknown);
	return Effect.tryPromise({
		try: () => Promise.resolve(definition.validateConfig!(rawConfig)),
		catch: (error) =>
			new Error(
				`Plugin "${definition.name}" config validation failed: ${error instanceof Error ? error.message : String(error)}`,
			),
	}).pipe(Effect.orDie);
}

function makeResolvedPlugin(
	definition: AnyPluginDefinition,
	config: unknown,
	moduleDir?: string,
): Effect.Effect<ResolvedPlugin> {
	const autoSkillPaths = moduleDir ? discoverSkillPaths(moduleDir) : [];
	const explicitSkillPaths = definition.skillPaths ?? [];

	return Effect.tryPromise({
		try: () => Promise.resolve(definition.factory(config)),
		catch: (error) =>
			new Error(
				`Plugin "${definition.name}" factory failed: ${error instanceof Error ? error.message : String(error)}`,
			),
	}).pipe(
		Effect.orDie,
		Effect.map((plain) => ({
			name: definition.name,
			trackerLayer: adaptTrackerClient(plain),
			skillPaths: [...new Set([...autoSkillPaths, ...explicitSkillPaths])],
		})),
	);
}

export function resolvePlugin(
	resolved: ResolvedConfig,
): Effect.Effect<ResolvedPlugin> {
	syncGithubRepoEnv(resolved);
	const rawConfig = buildPluginConfig(resolved);
	const builtin = builtinTrackers[resolved.trackerKind];

	if (builtin) {
		return resolveDefinitionConfig(builtin.definition, rawConfig).pipe(
			Effect.flatMap((config) =>
				makeResolvedPlugin(builtin.definition, config, builtin.moduleDir),
			),
		);
	}

	return Effect.gen(function* () {
		const kind = resolved.trackerKind;
		const mod = yield* Effect.tryPromise({
			try: () => import(kind) as Promise<{ default?: AnyPluginDefinition }>,
			catch: (cause) =>
				new Error(
					`Failed to load tracker plugin "${kind}": ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		}).pipe(Effect.orDie);
		const definition = mod.default;
		if (
			!definition ||
			typeof definition !== "object" ||
			typeof definition.name !== "string" ||
			typeof definition.factory !== "function"
		) {
			return yield* Effect.die(
				new Error(
					`Tracker plugin "${kind}" does not export a valid default tracker plugin definition`,
				),
			);
		}

		const config = yield* resolveDefinitionConfig(definition, rawConfig);
		const moduleDir =
			kind.startsWith("./") || kind.startsWith("../") || kind.startsWith("/")
				? dirname(resolve(kind))
				: undefined;

		return yield* makeResolvedPlugin(definition, config, moduleDir);
	});
}

export function makeTrackerLayer(resolvedPlugin: ResolvedPlugin) {
	return resolvedPlugin.trackerLayer;
}

export function makeAppLayer(resolvedPlugin: ResolvedPlugin) {
	return Layer.mergeAll(
		makeTrackerLayer(resolvedPlugin),
		PiAgentLive,
		BunServices.layer,
		Layer.succeed(
			PluginContext,
			PluginContext.of({
				skillPaths: resolvedPlugin.skillPaths,
			}),
		),
	);
}

export function makeOrchestratorLayer(resolvedPlugin: ResolvedPlugin) {
	return Orchestrator.layer.pipe(Layer.provide(makeAppLayer(resolvedPlugin)));
}

export function makeObservabilityLayer(resolvedPlugin: ResolvedPlugin) {
	return ObservabilityApi.layer.pipe(
		Layer.provide(makeOrchestratorLayer(resolvedPlugin)),
	);
}

export function makeStartupLayer(
	config: ServerConfig,
	resolvedPlugin: ResolvedPlugin,
) {
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
