import { Console } from "node:console";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	Config,
	ConfigProvider,
	Effect,
	ManagedRuntime,
	Stream,
} from "effect";
import type {
	AgentRuntimeEvent,
	RuntimeSnapshot,
} from "@plot/sdk";
import { Orchestrator } from "./core/index.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { makeOrchestratorRuntime, resolvePlugin } from "./runtime-builder.js";
import { resolveOverrides } from "./lib/detect-repo.js";

type StartMessage = { type: "start"; env: Record<string, string> };
type StopMessage = { type: "stop" };
type WorkerMessage = StartMessage | StopMessage;

let started = false;
let runtime: ManagedRuntime.ManagedRuntime<
	Orchestrator,
	Config.ConfigError
> | null = null;
let orchestrator: Orchestrator["Service"] | null = null;

function postSnapshot(snapshot: RuntimeSnapshot) {
	self.postMessage({ type: "snapshot", snapshot });
}

function postEvent(event: AgentRuntimeEvent) {
	self.postMessage({ type: "event", event });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;
	if (message.type === "stop") {
		void shutdown();
		return;
	}
	if (started) {
		self.postMessage({
			type: "error",
			error: "tui server worker already started",
		});
		return;
	}
	started = true;
	void boot(message.env);
};

async function boot(env: Record<string, string>) {
	try {
		redirectProcessOutput(env["PLOT_TUI_SERVER_LOG_PATH"]);
		const provider = ConfigProvider.fromEnv({ env });
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
		const resolvedPlugin = await Effect.runPromise(resolvePlugin(resolved, { refreshPlugins: config.refreshPlugins }));
		runtime = makeOrchestratorRuntime(config, resolvedPlugin);
		orchestrator = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* Orchestrator;
			}),
		);

		runtime.runFork(
			Stream.runForEach(orchestrator.snapshotStream, (snap) =>
				Effect.sync(() => {
					postSnapshot(snap);
				}),
			),
		);

		runtime.runFork(
			Stream.runForEach(orchestrator.eventStream, (event) =>
				Effect.sync(() => {
					postEvent(event);
				}),
			),
		);

		postSnapshot(await runtime.runPromise(orchestrator.getSnapshot));
		self.postMessage({ type: "ready" });
	} catch (error) {
		self.postMessage({
			type: "error",
			error:
				error instanceof Error
					? [error.message, error.stack].filter(Boolean).join("\n")
					: String(error),
		});
	}
}

async function shutdown() {
	if (runtime) await runtime.dispose();
	self.postMessage({ type: "stopped" });
	self.close();
}

function redirectProcessOutput(path?: string) {
	if (!path) return;
	mkdirSync(dirname(path), { recursive: true });
	const stream = createWriteStream(path, { flags: "a" });
	const write = (chunk: string | Uint8Array) => {
		stream.write(typeof chunk === "string" ? chunk : Buffer.from(chunk));
		return true;
	};
	process.stdout.write = write as typeof process.stdout.write;
	process.stderr.write = write as typeof process.stderr.write;
	const redirectedConsole = new Console({
		stdout: process.stdout,
		stderr: process.stderr,
	});
	console.log = redirectedConsole.log.bind(redirectedConsole);
	console.info = redirectedConsole.info.bind(redirectedConsole);
	console.warn = redirectedConsole.warn.bind(redirectedConsole);
	console.error = redirectedConsole.error.bind(redirectedConsole);
	console.debug = redirectedConsole.debug.bind(redirectedConsole);
}
