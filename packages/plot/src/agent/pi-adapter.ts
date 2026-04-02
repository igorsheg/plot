import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Cause, Config, DateTime, Effect, Layer, Queue, Ref, Stream } from "effect";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent, Usage } from "@mariozechner/pi-ai";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";
import {
	createAgentSession,
	AuthStorage,
	ModelRegistry,
	SessionManager,
	DefaultResourceLoader,
	createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { getModel, type Api, type Model } from "@mariozechner/pi-ai";
import { AgentRuntimeEvent } from "@plot/sdk";
import { AgentRunnerError, AgentService, type AgentRunConfig } from "./agent-service.js";

function parseModelSpec(spec: string): { provider: string; modelId: string } | null {
	const slashIndex = spec.indexOf("/");
	if (slashIndex <= 0 || slashIndex === spec.length - 1) return null;
	return { provider: spec.slice(0, slashIndex), modelId: spec.slice(slashIndex + 1) };
}

/** Ordered model preferences — first match wins. Prefix entries use startsWith. */
const DEFAULT_MODEL_PREFERENCE = [
	{ id: "claude-opus-4-6", prefix: false },
	{ id: "claude-opus-4", prefix: true },
	{ id: "claude-sonnet-4-20250514", prefix: false },
] as const;

function resolveModel(
	modelSpec: string | undefined,
	registry: ModelRegistry,
	available: ReadonlyArray<Model<Api>>,
): Model<Api> {
	if (modelSpec) {
		const parsed = parseModelSpec(modelSpec);
		if (parsed) {
			const fromRegistry = registry.find(parsed.provider, parsed.modelId);
			if (fromRegistry) return fromRegistry;
			return getModel(parsed.provider as never, parsed.modelId as never);
		}
	}
	const preferred = DEFAULT_MODEL_PREFERENCE.reduce<Model<Api> | undefined>(
		(found, pref) =>
			found ?? available.find((m) => (pref.prefix ? m.id.startsWith(pref.id) : m.id === pref.id)),
		undefined,
	);
	return (
		preferred ??
		available.find((m) => !m.id.includes("haiku")) ??
		available[0] ??
		getModel("anthropic", "claude-opus-4-6")
	);
}

const agentDir = dirname(fileURLToPath(import.meta.url));
const repoSkillDirectories = [".agent/skills", ".claude/skills"];

const PlotPiSkillsDir = Config.string("PI_SKILLS_DIR").pipe(
	Config.nested("PLOT"),
	Config.withDefault(join(agentDir, "../../resources/skills")),
);

const PlotAgentDir = Config.string("CODING_AGENT_DIR").pipe(
	Config.nested("PLOT"),
	Config.withDefault(join(homedir(), ".plot", "agent")),
);

function resolvePlotSkillPaths(workspacePath: string, coreSkillsDir: string) {
	return [
		coreSkillsDir,
		...repoSkillDirectories
			.map((relativePath) => join(workspacePath, relativePath))
			.filter((path) => existsSync(path)),
	];
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant";
}

function getMessageText(message: AgentMessage): string | null {
	if (!isAssistantMessage(message)) return null;
	const text = message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("");
	return text.length > 0 ? text : null;
}

function getUsage(message: AgentMessage): Usage | undefined {
	if (!isAssistantMessage(message)) return undefined;
	return message.usage;
}

function summarizeArgs(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	try {
		const str = JSON.stringify(args);
		return str.length > 200 ? str.slice(0, 197) + "..." : str;
	} catch {
		return null;
	}
}


interface MapperState {
	readonly turnCount: number;
	readonly sessionId: string | null;
	readonly cumulativeInputTokens: number;
	readonly cumulativeOutputTokens: number;
}

const initialMapperState: MapperState = {
	turnCount: 0,
	sessionId: null,
	cumulativeInputTokens: 0,
	cumulativeOutputTokens: 0,
};

function mapSessionEvent(
	acc: MapperState,
	event: AgentSessionEvent,
	threadId: string,
	issueId: string,
	issueIdentifier: string,
): readonly [MapperState, ReadonlyArray<AgentRuntimeEvent>] {
	const now = DateTime.nowUnsafe();
	const base = {
		agentPid: null,
		issueId,
		issueIdentifier,
		sessionId: acc.sessionId,
	} as const;

	switch (event.type) {
		case "agent_start": {
			const sessionId = `${threadId}-0`;
			return [
				{ ...acc, sessionId },
				[
					new AgentRuntimeEvent({
						event: "agent_start",
						timestamp: now,
						...base,
						sessionId,
						message: null,
					}),
				],
			];
		}

		case "agent_end":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "agent_end",
						timestamp: now,
						...base,
						message: null,
					}),
				],
			];

		case "turn_start": {
			const nextAcc = { ...acc, turnCount: acc.turnCount + 1 };
			return [
				nextAcc,
				[
					new AgentRuntimeEvent({
						event: "turn_start",
						timestamp: now,
						...base,
						message: null,
					}),
				],
			];
		}

		case "turn_end": {
			const turnId = String(acc.turnCount);
			const sessionId = `${threadId}-${turnId}`;
			const text = getMessageText(event.message);
			const usage = getUsage(event.message);
			const inputTokens = acc.cumulativeInputTokens + (usage?.input ?? 0);
			const outputTokens = acc.cumulativeOutputTokens + (usage?.output ?? 0);
			const nextAcc: MapperState = {
				...acc,
				sessionId,
				cumulativeInputTokens: inputTokens,
				cumulativeOutputTokens: outputTokens,
			};
			return [
				nextAcc,
				[
					new AgentRuntimeEvent({
						event: "turn_end",
						timestamp: now,
						...base,
						sessionId,
						message: text,
						usage: {
							inputTokens,
							outputTokens,
							totalTokens: inputTokens + outputTokens,
						},
					}),
				],
			];
		}

		case "message_start":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "message_start",
						timestamp: now,
						...base,
						message: null,
					}),
				],
			];

		case "message_update":
			if (event.assistantMessageEvent.type === "text_delta") {
				return [
					acc,
					[
						new AgentRuntimeEvent({
							event: "notification",
							timestamp: now,
							...base,
							message: event.assistantMessageEvent.delta,
						}),
					],
				];
			}
			return [acc, []];

		case "message_end":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "message_end",
						timestamp: now,
						...base,
						message: getMessageText(event.message),
					}),
				],
			];

		case "tool_execution_start":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "tool_execution_start",
						timestamp: now,
						...base,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						message: summarizeArgs(event.args),
					}),
				],
			];

		case "tool_execution_update":
			return [acc, []];

		case "tool_execution_end":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "tool_execution_end",
						timestamp: now,
						...base,
						toolCallId: event.toolCallId,
						toolName: event.toolName,
						isError: event.isError,
						message: null,
					}),
				],
			];

		case "auto_compaction_start":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "auto_compaction_start",
						timestamp: now,
						...base,
						message: event.reason ?? null,
					}),
				],
			];

		case "auto_compaction_end":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "auto_compaction_end",
						timestamp: now,
						...base,
						message: event.aborted ? "aborted" : null,
					}),
				],
			];

		case "auto_retry_start":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "auto_retry_start",
						timestamp: now,
						...base,
						message: `retry attempt ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms: ${event.errorMessage}`,
					}),
				],
			];

		case "auto_retry_end":
			return [
				acc,
				[
					new AgentRuntimeEvent({
						event: "auto_retry_end",
						timestamp: now,
						...base,
						message: event.success
							? `succeeded on attempt ${event.attempt}`
							: `failed: ${event.finalError ?? "unknown"}`,
					}),
				],
			];

		default:
			return [acc, []];
	}
}


const createEventStream = (
	config: AgentRunConfig,
): Stream.Stream<AgentRuntimeEvent, AgentRunnerError> =>
	Stream.unwrap(
		Effect.gen(function* () {
			const plotAgentDir = yield* PlotAgentDir.asEffect().pipe(
				Effect.mapError((e) => new AgentRunnerError({ code: "config_error", message: String(e) })),
			);
			const plotSkillsDir = yield* PlotPiSkillsDir.asEffect().pipe(
				Effect.mapError((e) => new AgentRunnerError({ code: "config_error", message: String(e) })),
			);

			const bootstrapStart = Date.now();
			const authStorage = AuthStorage.create(join(plotAgentDir, "auth.json"));
			const modelRegistry = new ModelRegistry(authStorage, join(plotAgentDir, "models.json"));
			const available = modelRegistry.getAvailable();
			const model = resolveModel(config.modelSpec, modelRegistry, available);

			const preflightKey = yield* Effect.tryPromise({
				try: () => modelRegistry.getApiKey(model),
				catch: (e) =>
					new AgentRunnerError({
						code: "auth_error",
						message: `Failed to get API key for ${model.provider}/${model.id}: ${e}`,
					}),
			});
			if (!preflightKey) {
				yield* Effect.logError("agent_auth_failed").pipe(
					Effect.annotateLogs({
						issue_id: config.issueId,
						model: `${model.provider}/${model.id}`,
					}),
				);
				return yield* new AgentRunnerError({
					code: "auth_error",
					message: `No API key for ${model.provider}/${model.id}. Token may have expired — run '/login ${model.provider}' to re-authenticate.`,
				});
			}

			const skillPaths = resolvePlotSkillPaths(config.workspacePath, plotSkillsDir);
			const loader = new DefaultResourceLoader({
				cwd: config.workspacePath,
				systemPromptOverride: () => config.systemPrompt,
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				additionalSkillPaths: skillPaths,
			});
			yield* Effect.tryPromise({
				try: () => loader.reload(),
				catch: (e) =>
					new AgentRunnerError({
						code: "agent_prompt_failed",
						message: `Resource loader reload failed: ${e}`,
					}),
			});

			const { skills: loadedSkills } = loader.getSkills();
			const { session } = yield* Effect.tryPromise({
				try: () =>
					createAgentSession({
						cwd: config.workspacePath,
						authStorage,
						modelRegistry,
						model,
						tools: createCodingTools(config.workspacePath),
						resourceLoader: loader,
						sessionManager: SessionManager.inMemory(config.workspacePath),
					}),
				catch: (e) =>
					new AgentRunnerError({
						code: "agent_prompt_failed",
						message: `Failed to create agent session: ${e}`,
					}),
			});

			// session cleanup on scope close
			yield* Effect.addFinalizer(() => Effect.sync(() => session.dispose()));

			yield* Effect.logInfo("agent_session_created").pipe(
				Effect.annotateLogs({
					component: "agent",
					issue_id: config.issueId,
					identifier: config.issueIdentifier,
					model: `${model.provider}/${model.id}`,
					workspace: config.workspacePath,
					max_turns: String(config.maxTurns),
					skill_count: String(loadedSkills.length),
					bootstrap_ms: String(Date.now() - bootstrapStart),
				}),
			);

			const abortingRef = yield* Ref.make(false);
			const abortSession = Effect.fn(function* (reason: string) {
				const alreadyAborting = yield* Ref.getAndSet(abortingRef, true);
				if (alreadyAborting) return;
				yield* Effect.logInfo("agent_abort").pipe(
					Effect.annotateLogs({
						issue_id: config.issueId,
						identifier: config.issueIdentifier,
						reason,
					}),
				);
				yield* Effect.promise(() => session.abort().catch(() => {}));
			});

			const threadId = crypto.randomUUID();

			const raw = Stream.callback<AgentSessionEvent, AgentRunnerError>(
				Effect.fn(function* (queue) {
					const unsub = session.subscribe((event: AgentSessionEvent) => {
						Queue.offerUnsafe(queue, event);
						if (event.type === "agent_end") Queue.endUnsafe(queue);
					});
					yield* Effect.addFinalizer(() => Effect.sync(() => unsub()));
					yield* Effect.forkScoped(
						Effect.tryPromise({
							try: () => session.prompt(config.prompt),
							catch: (e) =>
								new AgentRunnerError({
									code: "agent_prompt_failed",
									message: `Agent prompt failed: ${e}`,
								}),
						}).pipe(
							Effect.timeoutOrElse({
								duration: `${config.turnTimeoutMs} millis`,
								onTimeout: () =>
									Effect.fail(
										new AgentRunnerError({
											code: "agent_turn_timeout",
											message: `Agent turn timed out after ${config.turnTimeoutMs}ms`,
										}),
									),
							}),
							Effect.catch((error) =>
								Effect.sync(() => Queue.failCauseUnsafe(queue, Cause.fail(error))),
							),
						),
					);
				}),
			);

			return raw.pipe(
				Stream.timeout(`${config.stallTimeoutMs} millis`),
				Stream.mapAccumEffect(
					() => initialMapperState,
					(acc: MapperState, event: AgentSessionEvent) =>
						Effect.gen(function* () {
							const [nextAcc, events] = mapSessionEvent(
								acc,
								event,
								threadId,
								config.issueId,
								config.issueIdentifier,
							);

							// max_turns: abort after the turn that hits the limit
							if (event.type === "turn_start" && nextAcc.turnCount > config.maxTurns) {
								yield* abortSession(`max_turns reached (${config.maxTurns})`);
							}
							if (event.type === "turn_end" && nextAcc.turnCount >= config.maxTurns) {
								yield* abortSession(`max_turns reached (${config.maxTurns})`);
							}

							return [nextAcc, events] as const;
						}),
				),
			);
		}),
	);

export const PiAgentLive: Layer.Layer<AgentService> = Layer.succeed(AgentService, {
	run: (config) => createEventStream(config),
} as AgentService["Service"]);
