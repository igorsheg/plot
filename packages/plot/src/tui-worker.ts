import { Console } from "node:console";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	Config,
	ConfigProvider,
	Effect,
	ManagedRuntime,
	Schema,
	Stream,
} from "effect";
import {
	AgentRuntimeEvent,
	IssueEventLog,
	RefreshResult,
	RuntimeSnapshot,
} from "@plot/sdk";
import { ObservabilityApi } from "./observability-service.js";
import { ServerConfig, parseWorkflowFrontmatter } from "./config.js";
import { ResolvedConfig } from "./core/config-service.js";
import { makeObservabilityRuntime, resolvePlugin } from "./runtime-builder.js";

type StartMessage = { type: "start"; env: Record<string, string> };
type StopMessage = { type: "stop" };
type CallMessage = {
	type: "call";
	id: number;
	method: "triggerRefresh" | "getEventLog";
	identifier?: string;
};
type WorkerMessage = StartMessage | StopMessage | CallMessage;

type ResponseMessage =
	| { type: "response"; id: number; ok: true; result: unknown }
	| { type: "response"; id: number; ok: false; error: string };

const encodeSnapshot = Schema.encodeSync(RuntimeSnapshot);
const encodeEvent = Schema.encodeSync(AgentRuntimeEvent);
const encodeRefreshResult = Schema.encodeSync(RefreshResult);
const encodeIssueEventLog = Schema.encodeSync(IssueEventLog);

let started = false;
let runtime: ManagedRuntime.ManagedRuntime<
	ObservabilityApi,
	Config.ConfigError
> | null = null;
let api: ObservabilityApi["Service"] | null = null;
let currentSnapshot: RuntimeSnapshot | null = null;

function postSnapshot(snapshot: RuntimeSnapshot) {
	self.postMessage({ type: "snapshot", snapshot: encodeSnapshot(snapshot) });
}

function postEvent(event: AgentRuntimeEvent) {
	self.postMessage({ type: "event", event: encodeEvent(event) });
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;
	if (message.type === "stop") {
		void shutdown();
		return;
	}
	if (message.type === "call") {
		void handleCall(message);
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
		const resolved = new ResolvedConfig(workflowConfig, config.overrides);
		const resolvedPlugin = await Effect.runPromise(resolvePlugin(resolved));
		runtime = makeObservabilityRuntime(config, resolvedPlugin);
		api = await runtime.runPromise(
			Effect.gen(function* () {
				return yield* ObservabilityApi;
			}),
		);

		currentSnapshot = await runtime.runPromise(api.getState);

		runtime.runFork(
			Stream.runForEach(api.stateStream, (snap) =>
				Effect.sync(() => {
					currentSnapshot = snap;
					postSnapshot(snap);
				}),
			),
		);

		runtime.runFork(
			Stream.runForEach(api.eventStream, (event) =>
				Effect.sync(() => {
					postEvent(event);
				}),
			),
		);

		postSnapshot(currentSnapshot);
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

async function handleCall(message: CallMessage) {
	if (!runtime || !api) {
		postResponse({
			type: "response",
			id: message.id,
			ok: false,
			error: "tui runtime is not ready",
		});
		return;
	}
	try {
		const result =
			message.method === "getEventLog"
				? encodeIssueEventLog(
						await runtime.runPromise(
							api.getEventLog(message.identifier ?? ""),
						),
					)
				: encodeRefreshResult(await runtime.runPromise(api.triggerRefresh));
		postResponse({ type: "response", id: message.id, ok: true, result });
	} catch (error) {
		postResponse({
			type: "response",
			id: message.id,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

async function shutdown() {
	if (runtime) await runtime.dispose();
	process.exit(0);
}

function postResponse(message: ResponseMessage) {
	self.postMessage(message);
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
