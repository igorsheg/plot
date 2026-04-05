import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigProvider, Effect, ManagedRuntime, Stream } from "effect";
import type {
	AgentRuntimeEvent,
	RuntimeSnapshot,
	JsonRpcRequest,
} from "@plot/sdk";
import { notification, response, rpcError, RpcErrorCode } from "@plot/sdk";
import { Orchestrator } from "./core/index.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { makeOrchestratorRuntime, resolvePlugin } from "./runtime-builder.js";
import { resolveOverrides } from "./lib/detect-repo.js";

function writeLine(obj: unknown) {
	process.stdout.write(JSON.stringify(obj) + "\n");
}

export async function runRpcMain(
	env: Record<string, string | undefined>,
): Promise<void> {
	console.log = (...args) => process.stderr.write(args.join(" ") + "\n");
	console.info = (...args) => process.stderr.write(args.join(" ") + "\n");
	console.warn = (...args) => process.stderr.write(args.join(" ") + "\n");
	console.debug = (...args) => process.stderr.write(args.join(" ") + "\n");

	const filteredEnv = Object.fromEntries(
		Object.entries(env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	const provider = ConfigProvider.fromEnv({ env: filteredEnv });

	let runtime: ManagedRuntime.ManagedRuntime<Orchestrator, any> | null = null;
	const startedAt = Date.now();

	try {
		const config = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ServerConfig;
			}).pipe(Effect.provide(ConfigProvider.layer(provider))),
		);

		const content = readFileSync(config.workflowPath, "utf-8");
		const workflowConfig = parseWorkflowFrontmatter(content);
		const projectDir = dirname(config.workflowPath);
		const overrides = await resolveOverrides(config.overrides, projectDir);
		const resolved = new ResolvedConfig(workflowConfig, overrides, projectDir);
		const resolvedPlugin = await Effect.runPromise(
			resolvePlugin(resolved, { refreshPlugins: config.refreshPlugins }),
		);

		runtime = makeOrchestratorRuntime(config, resolvedPlugin);
		const orchestrator = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* Orchestrator;
			}),
		);

		runtime.runFork(
			Stream.runForEach(
				orchestrator.snapshotStream,
				(snapshot: RuntimeSnapshot) =>
					Effect.sync(() =>
						writeLine(notification("state/update", { snapshot })),
					),
			),
		);

		runtime.runFork(
			Stream.runForEach(orchestrator.eventStream, (event: AgentRuntimeEvent) =>
				Effect.sync(() =>
					writeLine(
						notification("issue/event", { issueId: event.issueId, event }),
					),
				),
			),
		);

		const initialSnapshot = await runtime.runPromise(orchestrator.getSnapshot);
		writeLine(notification("state/update", { snapshot: initialSnapshot }));

		process.stderr.write("plot-rpc: ready\n");

		const reader = createStdinReader();
		for await (const line of reader) {
			if (!line.trim()) continue;
			try {
				const request = JSON.parse(line) as JsonRpcRequest;
				await handleRequest(request, orchestrator, runtime, startedAt);
			} catch {
				writeLine(
					rpcError(
						null,
						RpcErrorCode.ParseError,
						"Failed to parse JSON-RPC request",
					),
				);
			}
		}

		await shutdown(runtime);
	} catch (error) {
		process.stderr.write(
			`plot-rpc: fatal: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	}
}

async function handleRequest(
	request: JsonRpcRequest,
	orchestrator: Orchestrator["Service"],
	runtime: ManagedRuntime.ManagedRuntime<any, any>,
	startedAt: number,
): Promise<void> {
	try {
		switch (request.method) {
			case "health": {
				const snapshot = await runtime.runPromise(orchestrator.getSnapshot);
				const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000);
				writeLine(
					response(request.id, {
						status: "pass",
						version: process.env["PLOT_VERSION"] ?? "0.0.1",
						uptimeSeconds,
						agents: snapshot.running.length,
					}),
				);
				break;
			}
			case "refresh": {
				const result = await runtime.runPromise(orchestrator.triggerRefresh);
				writeLine(response(request.id, { queued: result.queued }));
				break;
			}
			case "focus": {
				const params = request.params as { issueId: string };
				try {
					const log = await runtime.runPromise(
						orchestrator.getEventLog(params.issueId),
					);
					writeLine(response(request.id, { events: log.events }));
				} catch {
					writeLine(response(request.id, { events: [] }));
				}
				break;
			}
			case "unfocus": {
				writeLine(response(request.id, {}));
				break;
			}
			case "stop": {
				writeLine(response(request.id, {}));
				await shutdown(runtime);
				break;
			}
			default:
				writeLine(
					rpcError(
						request.id,
						RpcErrorCode.MethodNotFound,
						`Unknown method: ${request.method}`,
					),
				);
		}
	} catch (err) {
		writeLine(
			rpcError(
				request.id,
				RpcErrorCode.InternalError,
				err instanceof Error ? err.message : String(err),
			),
		);
	}
}

async function shutdown(
	runtime: ManagedRuntime.ManagedRuntime<any, any> | null,
): Promise<void> {
	if (runtime) await runtime.dispose();
	process.exit(0);
}

async function* createStdinReader(): AsyncGenerator<string> {
	let buffer = "";
	const decoder = new TextDecoder();
	for await (const chunk of process.stdin as unknown as AsyncIterable<Uint8Array>) {
		buffer += decoder.decode(chunk, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			yield line;
		}
	}
	if (buffer) yield buffer;
}
