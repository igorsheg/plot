import { BunRuntime } from "@effect/platform-bun";
import { Layer } from "effect";
import { makeServer } from "./server.js";
import { readConfigFromEnv } from "./config.js";

export { makeServer } from "./server.js";
export { readConfigFromEnv, type ServerConfig } from "./config.js";
export { RpcHandlersLive } from "./rpc-handlers.js";

export async function runServerMain(
	env: Record<string, string | undefined>,
): Promise<void> {
	const config = readConfigFromEnv(env);

	const file = Bun.file(config.workflowPath);
	if (!(await file.exists())) {
		console.error(`error: workflow file not found: ${config.workflowPath}`);
		process.exit(1);
	}

	return BunRuntime.runMain(Layer.launch(makeServer(config)));
}
