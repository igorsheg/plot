import { BunRuntime } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer } from "effect";
import { dirname } from "node:path";
import { makeServer } from "./server.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { resolvePlugin } from "./runtime-builder.js";
import { PluginInitError, ServerStartupError } from "./core/errors.js";
import { resolveOverrides } from "./lib/detect-repo.js";

interface StartupErrorPayload {
	readonly _tag: string;
	readonly message: string;
	readonly pluginName?: string;
	readonly phase?: string;
	readonly retryable?: boolean;
}

function writeStartupError(error: StartupErrorPayload) {
	const payload = JSON.stringify({
		type: "startup_error",
		error: {
			tag: error._tag,
			message: error.message,
			...(error._tag === "PluginInitError" ? { 
				pluginName: error.pluginName, 
				phase: error.phase, 
				retryable: error.retryable 
			} : {}),
		},
	});
	process.stderr.write(payload + "\n");
}

export async function runServerMain(
	env: Record<string, string | undefined>,
): Promise<void> {
	const provider = ConfigProvider.fromEnv({
		env: Object.fromEntries(
			Object.entries(env).filter(
				(entry): entry is [string, string] => entry[1] !== undefined,
			),
		),
	});

	const program = Effect.gen(function* () {
		const config = yield* ServerConfig;

		const exists = yield* Effect.promise(() =>
			Bun.file(config.workflowPath).exists(),
		);
		if (!exists) {
			return yield* new ServerStartupError({
				message: `workflow file not found: ${config.workflowPath}`,
			});
		}

		const content = yield* Effect.promise(() =>
			Bun.file(config.workflowPath).text(),
		);
		const workflowConfig = parseWorkflowFrontmatter(content);
		const projectDir = dirname(config.workflowPath);
		const overrides = yield* Effect.promise(() => resolveOverrides(config.overrides, projectDir));
		const resolved = new ResolvedConfig(workflowConfig, overrides, projectDir);
		const resolvedPlugin = yield* resolvePlugin(resolved, { refreshPlugins: config.refreshPlugins });

		return yield* Layer.launch(makeServer(config, resolvedPlugin));
	}).pipe(
		Effect.provide(ConfigProvider.layer(provider)),
		Effect.catchTag("PluginInitError", (e: PluginInitError) =>
			Effect.sync(() => {
				writeStartupError({
					_tag: e._tag,
					message: e.message,
					pluginName: e.pluginName,
					phase: e.phase,
					retryable: e.retryable,
				});
				process.exit(1);
			}),
		),
		Effect.catchTag("ServerStartupError", (e: ServerStartupError) =>
			Effect.sync(() => {
				writeStartupError({
					_tag: e._tag,
					message: e.message,
				});
				process.exit(1);
			}),
		),
	);

	BunRuntime.runMain(program);
}
