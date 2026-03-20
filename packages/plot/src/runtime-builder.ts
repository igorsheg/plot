import { BunServices } from "@effect/platform-bun";
import { DateTime, Effect, Layer, Logger, LogLevel, ManagedRuntime, References } from "effect";
import { AtomRegistry } from "effect/unstable/reactivity";
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
	AgentPreset,
	UpdateIssueOptions,
} from "@plot/sdk";
import { PiAgentLive } from "./agent/index.js";
import type { ServerConfig } from "./config.js";
import { Orchestrator } from "./core/index.js";

import { WorkflowLoader } from "./core/workflow-loader.js";
import { WorkspaceManager } from "./core/workspace-manager.js";
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
	const logger = config.logFormat === "json" ? Logger.consoleJson : Logger.consolePretty();
	return Layer.mergeAll(
		Logger.layer([logger]),
		Layer.succeed(References.MinimumLogLevel, parseServerLogLevel(config.logLevel)),
	);
}

export interface ResolvedPlugin {
	readonly name: string;
	readonly trackerLayer: Layer.Layer<TrackerClient>;
}

// ---------------------------------------------------------------------------
// Adaptation: PlainTrackerClient → Layer<TrackerClient>
// ---------------------------------------------------------------------------

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

function toDateTime(value: Date | string | null | undefined): DateTime.Utc | null {
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
		autoMerge: plain.autoMerge,
		createdAt: toDateTime(plain.createdAt),
		updatedAt: toDateTime(plain.updatedAt),
	});
}

function normalizeIssueStateEntry(plain: IssueStateEntryLike): IssueStateEntry {
	return new IssueStateEntry({ id: plain.id, state: plain.state });
}

function normalizeRunContext(plain: TrackerRunContextLike | null): TrackerRunContext | null {
	if (plain == null) return null;
	return new TrackerRunContext({
		raw: plain.raw ?? null,
		promptContext: plain.promptContext ?? null,
		workpad: plain.workpad ?? null,
		reviewFeedback: plain.reviewFeedback ?? null,
		workpadSections: (plain.workpadSections ?? []).map((s) => new WorkpadSection(s)),
	});
}

function adaptTrackerClient(plain: PlainTrackerClient): Layer.Layer<TrackerClient> {
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
			...(plain.updateIssue && {
				updateIssue: (options: UpdateIssueOptions) =>
					Effect.tryPromise({
						try: () => plain.updateIssue!(options),
						catch: (e) => mapPluginError(e, "updateIssue"),
					}),
			}),
			...(plain.cancelIssue && {
				cancelIssue: (issueId: string) =>
					Effect.tryPromise({
						try: () => plain.cancelIssue!(issueId),
						catch: (e) => mapPluginError(e, "cancelIssue"),
					}),
			}),
			...(plain.ensureInProgress && {
				ensureInProgress: (issueId: string) =>
					Effect.tryPromise({
						try: () => plain.ensureInProgress!(issueId),
						catch: (e) => mapPluginError(e, "ensureInProgress"),
					}),
			}),
			...(plain.issueAgentPreset && {
				issueAgentPreset: (issue: Issue) =>
					Effect.tryPromise({
						try: () =>
							plain.issueAgentPreset!({
								...issue,
								description: issue.description ?? undefined,
								url: issue.url ?? undefined,
								blockedBy: issue.blockedBy?.map((b) => ({
									id: b.id,
									identifier: b.identifier,
									state: b.state,
								})),
								createdAt: issue.createdAt
									? new Date(DateTime.toEpochMillis(issue.createdAt))
									: undefined,
								updatedAt: issue.updatedAt
									? new Date(DateTime.toEpochMillis(issue.updatedAt))
									: undefined,
							}),
						catch: (e) => mapPluginError(e, "issueAgentPreset"),
					}).pipe(Effect.map((p) => (p ? new AgentPreset(p) : null))),
			}),
			...(plain.updateAgentPreset && {
				updateAgentPreset: (preset: AgentPreset) =>
					Effect.tryPromise({
						try: () => plain.updateAgentPreset!(preset),
						catch: (e) => mapPluginError(e, "updateAgentPreset"),
					}).pipe(Effect.map((p) => new AgentPreset(p))),
			}),
			...(plain.agentPresetInfo && {
				agentPresetInfo: (preset: AgentPreset) =>
					Effect.tryPromise({
						try: () => plain.agentPresetInfo!(preset),
						catch: (e) => mapPluginError(e, "agentPresetInfo"),
					}),
			}),
			...(plain.reset && {
				reset: () =>
					Effect.tryPromise({
						try: () => plain.reset!(),
						catch: (e) => mapPluginError(e, "reset"),
					}),
			}),
			...(plain.settings && {
				settings: (projectId: string) =>
					Effect.tryPromise({
						try: () => plain.settings!(projectId),
						catch: (e) => mapPluginError(e, "settings"),
					}),
			}),
		}),
	);
}

// ---------------------------------------------------------------------------
// Plugin resolution
// ---------------------------------------------------------------------------

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
): Effect.Effect<ResolvedPlugin> {
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
		})),
	);
}

export function resolvePlugin(resolved: ResolvedConfig): Effect.Effect<ResolvedPlugin> {
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
		return yield* makeResolvedPlugin(definition, config);
	});
}

export function makeTrackerLayer(resolvedPlugin: ResolvedPlugin) {
	return resolvedPlugin.trackerLayer;
}

export function makeAppLayer(resolvedPlugin: ResolvedPlugin) {
	const platformDeps = BunServices.layer;
	return Layer.mergeAll(
		AtomRegistry.layer,
		makeTrackerLayer(resolvedPlugin),
		PiAgentLive,
		platformDeps,
		WorkflowLoader.layer.pipe(Layer.provide(platformDeps)),
		WorkspaceManager.layer.pipe(Layer.provide(platformDeps)),
	);
}

export function makeOrchestratorLayer(resolvedPlugin: ResolvedPlugin) {
	return Orchestrator.layer.pipe(Layer.provide(makeAppLayer(resolvedPlugin)));
}

export function makeObservabilityLayer(resolvedPlugin: ResolvedPlugin) {
	return ObservabilityApi.layer.pipe(Layer.provide(makeOrchestratorLayer(resolvedPlugin)));
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

export function makeObservabilityRuntime(config: ServerConfig, resolvedPlugin: ResolvedPlugin) {
	return ManagedRuntime.make(
		Layer.mergeAll(
			makeObservabilityLayer(resolvedPlugin),
			makeStartupLayer(config, resolvedPlugin),
			makeLoggingLayer(config),
		),
	);
}
