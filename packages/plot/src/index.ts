import { BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer } from "effect";
import { makeServer } from "./server.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { resolvePlugin } from "./runtime-builder.js";

export { makeServer } from "./server.js";
export { ServerConfig, parseWorkflowFrontmatter, type WorkflowOverrides } from "./config.js";
export { ResolvedConfig, validateForDispatch } from "./core/config-service.js";
export {
	makeAppLayer,
	makeLoggingLayer,
	makeOrchestratorLayer,
	makeOrchestratorRuntime,
	makeStartupLayer,
	makeTrackerLayer,
	parseServerLogLevel,
	resolvePlugin,
	type ResolvedPlugin,
} from "./runtime-builder.js";
export { RpcHandlersLive } from "./rpc-handlers.js";
export * from "./core/index.js";
export * from "./agent/index.js";
export * from "./tracker/index.js";

export async function runServerMain(env: Record<string, string | undefined>): Promise<void> {
	const provider = ConfigProvider.fromEnv({
		env: Object.fromEntries(
			Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
		),
	});

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
		const resolvedPlugin = yield* resolvePlugin(resolved);

		yield* Layer.launch(makeServer(config, resolvedPlugin));
	}).pipe(Effect.provide(ConfigProvider.layer(provider)));

	BunRuntime.runMain(program as Effect.Effect<void>);
}
