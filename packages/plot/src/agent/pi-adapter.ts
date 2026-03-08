import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { Config, Effect, Layer, Stream } from "effect";
import { DateTime } from "effect";
import { AgentRuntimeEvent } from "@plot/sdk";
import { AgentRunnerError } from "../schemas/errors.js";
import {
  createAgentSession,
  AuthStorage,
  ModelRegistry,
  SessionManager,
  DefaultResourceLoader,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { AgentService, type AgentRunConfig } from "./agent-service.js";

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

function resolvePlotSkillPaths(workspacePath: string, plotSkillsDir: string) {
  return [
    plotSkillsDir,
    ...repoSkillDirectories
      .map((relativePath) => join(workspacePath, relativePath))
      .filter((path) => existsSync(path)),
  ];
}

function extractMessageText(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (!("content" in m) || !Array.isArray(m["content"])) return null;
  const texts = (m["content"] as Array<Record<string, unknown>>)
    .filter((c) => c?.["type"] === "text" && typeof c["text"] === "string")
    .map((c) => c["text"] as string);
  return texts.length > 0 ? texts.join("") : null;
}

function extractUsage(
  msg: unknown,
): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;
  if (!("usage" in m) || !m["usage"] || typeof m["usage"] !== "object") return undefined;
  const u = m["usage"] as Record<string, unknown>;
  const input = typeof u["input"] === "number" ? u["input"] : 0;
  const output = typeof u["output"] === "number" ? u["output"] : 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output,
  };
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

const createEventStream = (
  config: AgentRunConfig,
  signal: AbortSignal,
): Stream.Stream<AgentRuntimeEvent, AgentRunnerError> =>
  Stream.asyncPush<AgentRuntimeEvent, AgentRunnerError>((emit) =>
    Effect.gen(function* () {
      const plotAgentDir = yield* PlotAgentDir.pipe(
        Effect.mapError((e) => new AgentRunnerError({ code: "config_error", message: String(e) })),
      );
      const plotSkillsDir = yield* PlotPiSkillsDir.pipe(
        Effect.mapError((e) => new AgentRunnerError({ code: "config_error", message: String(e) })),
      );
      const authStorage = AuthStorage.create(join(plotAgentDir, "auth.json"));
      const modelRegistry = new ModelRegistry(authStorage, join(plotAgentDir, "models.json"));
      const available = modelRegistry.getAvailable();
      const preferred =
        available.find((m) => m.id === "claude-opus-4-6") ??
        available.find((m) => m.id.startsWith("claude-opus-4")) ??
        available.find((m) => m.id === "claude-sonnet-4-20250514") ??
        available.find((m) => !m.id.includes("haiku")) ??
        available[0] ??
        getModel("anthropic", "claude-opus-4-6");
      const model = preferred;
      const loader = new DefaultResourceLoader({
        cwd: config.workspacePath,
        systemPromptOverride: () => config.systemPrompt,
        noSkills: true,
        additionalSkillPaths: resolvePlotSkillPaths(config.workspacePath, plotSkillsDir),
      });
      yield* Effect.tryPromise({
        try: () => loader.reload(),
        catch: (e) =>
          new AgentRunnerError({
            code: "agent_prompt_failed",
            message: `Resource loader reload failed: ${e}`,
          }),
      });

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

      yield* Effect.logInfo("agent_session_created").pipe(
        Effect.annotateLogs({
          component: "agent",
          issue_id: config.issueId,
          identifier: config.issueIdentifier,
          model_provider: model.provider,
          model_id: model.id,
          workspace: config.workspacePath,
          max_turns: String(config.maxTurns),
        }),
      );

      let turnCount = 0;
      let sessionId: string | null = null;
      let aborting = false;
      const threadId = crypto.randomUUID();
      let cumulativeInputTokens = 0;
      let cumulativeOutputTokens = 0;

      const abortSession = (reason: string) => {
        if (aborting) return;
        aborting = true;
        session.abort().catch(() => {});
        emit.single(
          new AgentRuntimeEvent({
            event: "notification",
            timestamp: DateTime.unsafeNow(),
            agentPid: null,
            issueId: config.issueId,
            issueIdentifier: config.issueIdentifier,
            sessionId,
            message: reason,
          }),
        );
      };

      const base = () =>
        ({
          agentPid: null,
          issueId: config.issueId,
          issueIdentifier: config.issueIdentifier,
          sessionId,
        }) as const;

      const unsubscribe = session.subscribe((raw) => {
        if (signal.aborted) return;
        const event = raw as unknown as Record<string, unknown>;

        const now = DateTime.unsafeNow();

        switch (event["type"]) {
          case "agent_start":
            sessionId = `${threadId}-0`;
            emit.single(
              new AgentRuntimeEvent({
                event: "agent_start",
                timestamp: now,
                ...base(),
                message: null,
              }),
            );
            break;

          case "agent_end":
            emit.single(
              new AgentRuntimeEvent({
                event: "agent_end",
                timestamp: now,
                ...base(),
                message: null,
              }),
            );
            emit.end();
            break;

          case "turn_start":
            turnCount++;
            emit.single(
              new AgentRuntimeEvent({
                event: "turn_start",
                timestamp: now,
                ...base(),
                message: null,
              }),
            );
            if (turnCount > config.maxTurns) {
              abortSession(`max_turns reached (${config.maxTurns})`);
            }
            break;

          case "turn_end": {
            const turnId = String(turnCount);
            sessionId = `${threadId}-${turnId}`;
            const text = extractMessageText(event["message"]);
            const turnUsage = extractUsage(event["message"]);
            if (turnUsage) {
              cumulativeInputTokens += turnUsage.inputTokens;
              cumulativeOutputTokens += turnUsage.outputTokens;
            }
            emit.single(
              new AgentRuntimeEvent({
                event: "turn_end",
                timestamp: now,
                ...base(),
                message: text,
                usage: {
                  inputTokens: cumulativeInputTokens,
                  outputTokens: cumulativeOutputTokens,
                  totalTokens: cumulativeInputTokens + cumulativeOutputTokens,
                },
              }),
            );

            if (turnCount >= config.maxTurns) {
              abortSession(`max_turns reached (${config.maxTurns})`);
            } else if (config.shouldContinue) {
              Effect.runFork(
                config.shouldContinue().pipe(
                  Effect.map((cont) => {
                    if (!cont) abortSession("issue no longer active");
                  }),
                  Effect.catchAll(() =>
                    Effect.sync(() => abortSession("issue state check failed")),
                  ),
                ),
              );
            }
            break;
          }

          case "message_start":
            emit.single(
              new AgentRuntimeEvent({
                event: "message_start",
                timestamp: now,
                ...base(),
                message: null,
              }),
            );
            break;

          case "message_update": {
            const assistantEvent = event["assistantMessageEvent"] as
              | { type: string; delta?: string }
              | undefined;
            if (assistantEvent?.type === "text_delta") {
              emit.single(
                new AgentRuntimeEvent({
                  event: "notification",
                  timestamp: now,
                  ...base(),
                  message: assistantEvent.delta ?? null,
                }),
              );
            }
            break;
          }

          case "message_end":
            emit.single(
              new AgentRuntimeEvent({
                event: "message_end",
                timestamp: now,
                ...base(),
                message: extractMessageText(event["message"]),
              }),
            );
            break;

          case "tool_execution_start":
            emit.single(
              new AgentRuntimeEvent({
                event: "tool_execution_start",
                timestamp: now,
                ...base(),
                toolCallId: event["toolCallId"] as string,
                toolName: event["toolName"] as string,
                message: summarizeArgs(event["args"]),
              }),
            );
            break;

          case "tool_execution_update":
            break;

          case "tool_execution_end":
            emit.single(
              new AgentRuntimeEvent({
                event: "tool_execution_end",
                timestamp: now,
                ...base(),
                toolCallId: event["toolCallId"] as string,
                toolName: event["toolName"] as string,
                isError: event["isError"] as boolean,
                message: null,
              }),
            );
            break;

          case "auto_compaction_start":
            emit.single(
              new AgentRuntimeEvent({
                event: "auto_compaction_start",
                timestamp: now,
                ...base(),
                message: (event["reason"] as string) ?? null,
              }),
            );
            break;

          case "auto_compaction_end":
            emit.single(
              new AgentRuntimeEvent({
                event: "auto_compaction_end",
                timestamp: now,
                ...base(),
                message: event["aborted"] ? "aborted" : null,
              }),
            );
            break;

          case "auto_retry_start":
            emit.single(
              new AgentRuntimeEvent({
                event: "auto_retry_start",
                timestamp: now,
                ...base(),
                message: `retry attempt ${event["attempt"]}/${event["maxAttempts"]} in ${event["delayMs"]}ms: ${event["errorMessage"]}`,
              }),
            );
            break;

          case "auto_retry_end":
            emit.single(
              new AgentRuntimeEvent({
                event: "auto_retry_end",
                timestamp: now,
                ...base(),
                message: (event["success"] as boolean)
                  ? `succeeded on attempt ${event["attempt"]}`
                  : `failed: ${event["finalError"] ?? "unknown"}`,
              }),
            );
            break;

          default:
            break;
        }
      });

      yield* Effect.acquireRelease(
        Effect.sync(() => unsubscribe),
        (unsub) =>
          Effect.sync(() => {
            unsub();
            session.dispose();
          }),
      );

      yield* Effect.forkScoped(
        Effect.tryPromise({
          try: () => session.prompt(config.prompt),
          catch: (e) =>
            new AgentRunnerError({
              code: "agent_prompt_failed",
              message: `Agent prompt failed: ${e}`,
            }),
        }).pipe(
          Effect.timeoutFail({
            duration: `${config.turnTimeoutMs} millis`,
            onTimeout: () =>
              new AgentRunnerError({
                code: "agent_turn_timeout",
                message: `Agent turn timed out after ${config.turnTimeoutMs}ms`,
              }),
          }),
          Effect.catchAll((error) => Effect.sync(() => emit.fail(error))),
        ),
      );
    }),
  );

export const PiAgentLive: Layer.Layer<AgentService> = Layer.succeed(
  AgentService,
  AgentService.of({
    run: (config, signal) => createEventStream(config, signal),
  }),
);
