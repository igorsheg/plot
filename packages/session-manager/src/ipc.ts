import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type {
	InterruptAgentRunInput,
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import { SessionManager, type SessionManagerRuntime } from "./manager.js";
import { createFileSessionStore } from "./session-store.js";
import { parseSessionSummary, type SessionSummary } from "./session.js";

export interface SessionManagerIpcOptions {
	readonly managerDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
}

type ManagerRequest =
	| {
			readonly type: "start";
			readonly cwd: string;
			readonly workflowPath?: string;
	  }
	| { readonly type: "find"; readonly workflowPath: string }
	| { readonly type: "get"; readonly sessionId: string }
	| { readonly type: "stop"; readonly workflowPath: string }
	| { readonly type: "stop-session"; readonly sessionId: string }
	| { readonly type: "list" }
	| {
			readonly type: "events";
			readonly sessionId: string;
			readonly after: number;
	  }
	| { readonly type: "tick" | "pause" | "resume"; readonly sessionId: string }
	| {
			readonly type: "interrupt";
			readonly sessionId: string;
			readonly input: InterruptAgentRunInput;
	  }
	| {
			readonly type: "observe";
			readonly sessionId: string;
			readonly input: OperatorObservationInput;
	  }
	| {
			readonly type: "source-action";
			readonly sessionId: string;
			readonly input: SourceActionInput;
	  }
	| {
			readonly type: "source-action-cancel";
			readonly sessionId: string;
			readonly actionRunId: string;
	  };

type ManagerResponse =
	| { readonly type: "result"; readonly ok: true; readonly value?: unknown }
	| { readonly type: "error"; readonly ok: false; readonly error: string }
	| { readonly type: "events-ready"; readonly session?: SessionSummary }
	| { readonly type: "event"; readonly event: RuntimeEvent };

const limits = { maxLineBytes: 2 * 1024 * 1024 } as const;
const directoryMode = 0o700;
const socketMode = 0o600;

const invalid = (label: string): never => {
	throw new Error(`invalid ${label}`);
};

const string = (value: unknown, label: string): string =>
	typeof value === "string" && value.length > 0 ? value : invalid(label);

const object = <A>(value: unknown, label: string): A =>
	isRecord(value) ? (value as A) : invalid(label);

const decodeRequest = (value: unknown): ManagerRequest => {
	if (!isRecord(value)) return invalid("Session Manager request");
	const type = value["type"];
	if (type === "list") return { type };
	if (type === "start") {
		const request: {
			type: "start";
			cwd: string;
			workflowPath?: string;
		} = { type, cwd: string(value["cwd"], "start cwd") };
		if (value["workflowPath"] !== undefined)
			request.workflowPath = string(value["workflowPath"], "workflowPath");
		return request;
	}
	if (type === "find" || type === "stop")
		return {
			type,
			workflowPath: string(value["workflowPath"], "workflowPath"),
		};
	if (type === "get" || type === "stop-session")
		return { type, sessionId: string(value["sessionId"], "sessionId") };
	if (type === "events") {
		const after = value["after"];
		if (typeof after !== "number" || !Number.isInteger(after) || after < 0)
			return invalid("event sequence");
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId"),
			after,
		};
	}
	if (type === "tick" || type === "pause" || type === "resume")
		return { type, sessionId: string(value["sessionId"], "sessionId") };
	if (type === "interrupt")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId"),
			input: object<InterruptAgentRunInput>(value["input"], "interrupt input"),
		};
	if (type === "observe")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId"),
			input: object<OperatorObservationInput>(value["input"], "observe input"),
		};
	if (type === "source-action")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId"),
			input: object<SourceActionInput>(value["input"], "Source action input"),
		};
	if (type === "source-action-cancel")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId"),
			actionRunId: string(value["actionRunId"], "actionRunId"),
		};
	return invalid("Session Manager request type");
};

const optionalSession = (value: unknown): SessionSummary | undefined =>
	value === undefined ? undefined : parseSessionSummary(value);

const decodeResponse = (value: unknown): ManagerResponse => {
	if (!isRecord(value)) return invalid("Session Manager response");
	if (value["type"] === "result" && value["ok"] === true)
		return { type: "result", ok: true, value: value["value"] };
	if (value["type"] === "error" && value["ok"] === false)
		return {
			type: "error",
			ok: false,
			error: string(value["error"], "manager error"),
		};
	if (value["type"] === "events-ready") {
		const session = optionalSession(value["session"]);
		return session === undefined
			? { type: "events-ready" }
			: { type: "events-ready", session };
	}
	if (value["type"] === "event" && isRecord(value["event"]))
		return { type: "event", event: value["event"] as unknown as RuntimeEvent };
	return invalid("Session Manager response type");
};

const managerDir = (options: SessionManagerIpcOptions): string =>
	resolve(options.managerDir ?? join(homedir(), ".plot", "session-manager"));

export const resolveSessionManagerSocket = (
	options: SessionManagerIpcOptions = {},
): string => join(managerDir(options), "manager.sock");

const write = (socket: { write: (text: string) => void }, value: unknown) =>
	socket.write(stringifyJsonl(value, limits));

const createManager = (options: SessionManagerIpcOptions): SessionManager => {
	if (options.cli === undefined)
		throw new Error("Session Manager requires the Plot executable");
	const dir = managerDir(options);
	return new SessionManager({
		store: createFileSessionStore(join(dir, "sessions.json")),
		cli: options.cli,
	});
};

const handleRequest = async (
	manager: SessionManagerRuntime,
	request: ManagerRequest,
): Promise<unknown> => {
	switch (request.type) {
		case "start":
			return manager.start(request);
		case "find":
			return manager.find(request.workflowPath);
		case "get":
			return manager.get(request.sessionId);
		case "stop":
			return manager.stop(request.workflowPath);
		case "stop-session":
			return manager.stopSession(request.sessionId);
		case "list":
			return manager.list();
		case "tick":
			return manager.tick(request.sessionId);
		case "pause":
			return manager.pause(request.sessionId);
		case "resume":
			return manager.resume(request.sessionId);
		case "interrupt":
			return manager.interrupt(request.sessionId, request.input);
		case "observe":
			return manager.observe(request.sessionId, request.input);
		case "source-action":
			return manager.startSourceAction(request.sessionId, request.input);
		case "source-action-cancel":
			return manager.cancelSourceAction(request.sessionId, request.actionRunId);
		case "events":
			return undefined;
	}
};

const removeStaleSocket = async (path: string) => {
	if (!existsSync(path)) return;
	const live = await new Promise<boolean>((resolveLive) => {
		const socket = createConnection(path);
		socket.once("connect", () => {
			socket.destroy();
			resolveLive(true);
		});
		socket.once("error", () => {
			socket.destroy();
			resolveLive(false);
		});
	});
	if (live) throw new Error(`Session Manager is already running: ${path}`);
	unlinkSync(path);
};

export const startSessionManagerServer = async (input: {
	readonly options: SessionManagerIpcOptions;
	readonly manager?: SessionManager;
}): Promise<{
	readonly manager: SessionManager;
	readonly server: Server;
	readonly socketPath: string;
}> => {
	const socketPath = resolveSessionManagerSocket(input.options);
	await mkdir(dirname(socketPath), { recursive: true, mode: directoryMode });
	if (process.platform !== "win32")
		await chmod(dirname(socketPath), directoryMode);
	await removeStaleSocket(socketPath);
	const manager = input.manager ?? createManager(input.options);
	await manager.recoverAfterRestart();
	const server = createServer((socket) => {
		void (async () => {
			for await (const line of jsonlLines(socket, limits)) {
				let request: ManagerRequest;
				try {
					request = decodeRequest(parseJsonl(line));
				} catch (error) {
					write(socket, {
						type: "error",
						ok: false,
						error: errorMessage(error),
					});
					return;
				}
				if (request.type === "events") {
					const session = await manager.get(request.sessionId);
					write(socket, { type: "events-ready", session });
					if (session !== undefined) {
						const controller = new AbortController();
						const abort = () => controller.abort();
						socket.once("close", abort);
						try {
							for await (const event of manager.events(
								request.sessionId,
								request.after,
								controller.signal,
							))
								write(socket, { type: "event", event });
						} finally {
							socket.off("close", abort);
						}
					}
					socket.end();
					return;
				}
				try {
					write(socket, {
						type: "result",
						ok: true,
						value: await handleRequest(manager, request),
					});
				} catch (error) {
					write(socket, {
						type: "error",
						ok: false,
						error: errorMessage(error),
					});
				}
				return;
			}
		})().catch((error) => {
			write(socket, { type: "error", ok: false, error: errorMessage(error) });
			socket.end();
		});
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolveListen);
	});
	if (process.platform !== "win32") await chmod(socketPath, socketMode);
	return { manager, server, socketPath };
};

const request = async (
	options: SessionManagerIpcOptions,
	value: ManagerRequest,
): Promise<unknown> => {
	const socket = createConnection(resolveSessionManagerSocket(options));
	try {
		await new Promise<void>((resolveConnect, reject) => {
			socket.once("connect", resolveConnect);
			socket.once("error", reject);
		});
		write(socket, value);
		for await (const line of jsonlLines(socket, limits)) {
			const response = decodeResponse(parseJsonl(line));
			if (response.type === "error") throw new Error(response.error);
			if (response.type === "result") return response.value;
		}
		throw new Error("Session Manager closed before responding");
	} finally {
		socket.destroy();
	}
};

const sessionValue = (value: unknown): SessionSummary | undefined =>
	value === undefined ? undefined : parseSessionSummary(value);

export const createSessionManagerClient = (
	options: SessionManagerIpcOptions = {},
): SessionManagerRuntime => ({
	start: async (input) => {
		const value = object<Record<string, unknown>>(
			await request(options, { type: "start", ...input }),
			"start result",
		);
		return {
			session: parseSessionSummary(value["session"]),
			started: value["started"] === true,
		};
	},
	find: async (workflowPath) =>
		sessionValue(await request(options, { type: "find", workflowPath })),
	get: async (sessionId) =>
		sessionValue(await request(options, { type: "get", sessionId })),
	stop: async (workflowPath) =>
		sessionValue(await request(options, { type: "stop", workflowPath })),
	stopSession: async (sessionId) =>
		sessionValue(await request(options, { type: "stop-session", sessionId })),
	list: async () => {
		const value = await request(options, { type: "list" });
		if (!Array.isArray(value)) throw new Error("invalid Session list");
		return value.map(parseSessionSummary);
	},
	events: (sessionId, after = 0, signal) => ({
		async *[Symbol.asyncIterator]() {
			const socket = createConnection(resolveSessionManagerSocket(options));
			if (signal?.aborted) {
				socket.destroy();
				return;
			}
			const abort = () => socket.destroy();
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const connected = await new Promise<boolean>(
					(resolveConnect, reject) => {
						const cleanup = () => {
							socket.off("connect", onConnect);
							socket.off("error", onError);
							socket.off("close", onClose);
						};
						const onConnect = () => {
							cleanup();
							resolveConnect(true);
						};
						const onError = (error: Error) => {
							cleanup();
							reject(error);
						};
						const onClose = () => {
							cleanup();
							resolveConnect(false);
						};
						socket.once("connect", onConnect);
						socket.once("error", onError);
						socket.once("close", onClose);
					},
				);
				if (!connected) return;
				write(socket, { type: "events", sessionId, after });
				for await (const line of jsonlLines(socket, limits)) {
					const response = decodeResponse(parseJsonl(line));
					if (response.type === "error") throw new Error(response.error);
					if (
						response.type === "events-ready" &&
						response.session === undefined
					)
						throw new Error(`unknown Session: ${sessionId}`);
					if (response.type === "event") yield response.event;
				}
			} finally {
				signal?.removeEventListener("abort", abort);
				socket.destroy();
			}
		},
	}),
	tick: async (sessionId) => {
		await request(options, { type: "tick", sessionId });
	},
	pause: async (sessionId) => {
		await request(options, { type: "pause", sessionId });
	},
	resume: async (sessionId) => {
		await request(options, { type: "resume", sessionId });
	},
	interrupt: async (sessionId, input) =>
		(await request(options, { type: "interrupt", sessionId, input })) === true,
	observe: async (sessionId, input) =>
		(await request(options, { type: "observe", sessionId, input })) === true,
	startSourceAction: async (sessionId, input) =>
		(await request(options, {
			type: "source-action",
			sessionId,
			input,
		})) as SourceActionStartResult,
	cancelSourceAction: async (sessionId, actionRunId) =>
		(await request(options, {
			type: "source-action-cancel",
			sessionId,
			actionRunId,
		})) === true,
	shutdown: async () => {},
});

const sleep = (ms: number) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const waitForManager = async (
	options: SessionManagerIpcOptions,
	timeoutMs = 5_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() <= deadline) {
		try {
			// eslint-disable-next-line no-await-in-loop -- bounded readiness polling.
			await request(options, { type: "list" });
			return;
		} catch (error) {
			lastError = error;
			// eslint-disable-next-line no-await-in-loop -- bounded readiness polling.
			await sleep(50);
		}
	}
	throw new Error(`Session Manager did not start: ${errorMessage(lastError)}`);
};

const startManagerDaemon = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	if (options.cli === undefined) throw new Error("Plot executable is required");
	const args = [...options.cli.args, "__internal-session-manager"];
	if (options.managerDir !== undefined)
		args.push("--manager-dir", options.managerDir);
	const child = spawn(options.cli.command, args, {
		detached: true,
		stdio: "ignore",
	});
	const failed = new Promise<never>((_resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) =>
			reject(
				new Error(`Session Manager exited before ready: ${signal ?? code}`),
			),
		);
	});
	child.unref();
	await Promise.race([waitForManager(options), failed]);
};

export const openSessionManager = async (
	options: SessionManagerIpcOptions,
): Promise<SessionManagerRuntime> => {
	try {
		await request(options, { type: "list" });
	} catch {
		await startManagerDaemon(options);
	}
	return createSessionManagerClient(options);
};

export const runSessionManagerDaemon = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	const started = await startSessionManagerServer({ options });
	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		started.server.close();
		await started.manager.shutdown();
		if (existsSync(started.socketPath)) unlinkSync(started.socketPath);
	};
	process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
	await new Promise<void>(() => {});
};
