import { BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer } from "effect";
import { makeServer } from "./server.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";

export { makeServer } from "./server.js";
export { ServerConfig, parseWorkflowFrontmatter, type WorkflowOverrides } from "./config.js";
export { ObservabilityApi, makeObservabilityApi } from "./observability-service.js";
export {
  makeAppLayer,
  makeLoggingLayer,
  makeObservabilityLayer,
  makeObservabilityRuntime,
  makeOrchestratorLayer,
  makeStartupLayer,
  makeTrackerLayer,
  parseServerLogLevel,
} from "./runtime-builder.js";
export { RpcHandlersLive } from "./rpc-handlers.js";
export * from "./core/index.js";
export * from "./agent/index.js";
export * from "./tracker/index.js";

export async function runServerMain(env: Record<string, string | undefined>): Promise<void> {
  const provider = ConfigProvider.fromMap(
    new Map(
      Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    { pathDelim: "_" },
  );

  const program = Effect.gen(function* () {
    const config = yield* ServerConfig;

    const exists = yield* Effect.promise(() => Bun.file(config.workflowPath).exists());
    if (!exists) {
      console.error(`error: workflow file not found: ${config.workflowPath}`);
      process.exit(1);
    }

    const content = yield* Effect.promise(() => Bun.file(config.workflowPath).text());
    const workflowConfig = parseWorkflowFrontmatter(content);
    const resolved = new ResolvedConfig(workflowConfig, config.overrides);

    yield* Layer.launch(makeServer(config, resolved));
  }).pipe(Effect.withConfigProvider(provider));

  return BunRuntime.runMain(program);
}
