import { Effect, Layer, Stream } from "effect";
import { DateTime } from "effect";
import { AgentRuntimeEvent } from "@plot/shared";
import { AgentRunnerError } from "@plot/shared";
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

const createEventStream = (
  config: AgentRunConfig,
  signal: AbortSignal,
): Stream.Stream<AgentRuntimeEvent, AgentRunnerError> =>
  Stream.asyncScoped<AgentRuntimeEvent, AgentRunnerError>((emit) =>
    Effect.gen(function* () {
      const authStorage = AuthStorage.create();
      const modelRegistry = new ModelRegistry(authStorage);
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

      const unsubscribe = session.subscribe((event) => {
        if (signal.aborted) return;

        const now = DateTime.unsafeNow();

        switch (event.type) {
          case "agent_start":
            sessionId = `${threadId}-0`;
            emit.single(
              new AgentRuntimeEvent({
                event: "session_started",
                timestamp: now,
                agentPid: null,
                issueId: config.issueId,
                issueIdentifier: config.issueIdentifier,
                sessionId,
                message: null,
              }),
            );
            break;

          case "turn_start":
            turnCount++;
            if (turnCount > config.maxTurns) {
              abortSession(`max_turns reached (${config.maxTurns})`);
            }
            break;

          case "turn_end": {
            const turnId = String(turnCount);
            sessionId = `${threadId}-${turnId}`;
            emit.single(
              new AgentRuntimeEvent({
                event: "turn_completed",
                timestamp: now,
                agentPid: null,
                issueId: config.issueId,
                issueIdentifier: config.issueIdentifier,
                sessionId,
                message: null,
              }),
            );

            if (turnCount >= config.maxTurns) {
              abortSession(`max_turns reached (${config.maxTurns})`);
            } else if (config.shouldContinue) {
              void config.shouldContinue().then((cont) => {
                if (!cont) abortSession("issue no longer active");
                return cont;
              });
            }
            break;
          }

          case "message_update":
            if (event.assistantMessageEvent.type === "text_delta") {
              emit.single(
                new AgentRuntimeEvent({
                  event: "notification",
                  timestamp: now,
                  agentPid: null,
                  issueId: config.issueId,
                  issueIdentifier: config.issueIdentifier,
                  sessionId,
                  message: event.assistantMessageEvent.delta,
                }),
              );
            }
            break;

          case "agent_end":
            emit.end();
            break;
        }
      });

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          unsubscribe();
          session.dispose();
        }),
      );

      yield* Effect.tryPromise({
        try: () => session.prompt(config.prompt),
        catch: (e) =>
          new AgentRunnerError({
            code: "agent_prompt_failed",
            message: `Agent prompt failed: ${e}`,
          }),
      });
    }),
  );

export const PiAgentLive: Layer.Layer<AgentService> = Layer.succeed(
  AgentService,
  AgentService.of({
    run: (config, signal) => createEventStream(config, signal),
  }),
);
