import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	boundaryErrorFromRecord,
	parseBoundaryErrorRecord,
	PlotBoundaryError,
	toBoundaryErrorRecord,
	type BoundaryErrorRecord,
} from "@plot/common/boundary-error";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type {
	InterruptAgentRunInput,
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/session/runtime";
import { WorkflowBoundaryError } from "@plot/session/workflow";
import {
	SessionManager,
	SessionNotControllableError,
	SessionNotFoundError,
	type SessionControlOperation,
	type SessionManagerRuntime,
} from "./manager.js";
import { createFileSessionStore } from "./session-store.js";
import {
	parseSessionSummary,
	type SessionState,
	type SessionSummary,
} from "./session.js";

export const sessionManagerProtocolVersion = 2;

export interface SessionManagerIpcOptions {
	readonly managerDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
	readonly identity?: string;
}

interface SessionManagerIdentity {
	readonly protocol: number;
	readonly build: string;
}

export class SessionManagerIdentityError extends PlotBoundaryError {
	override readonly name = "SessionManagerIdentityError";

	constructor(input: {
		readonly message: string;
		readonly client: SessionManagerIdentity;
		readonly daemon?: SessionManagerIdentity;
	}) {
		const context: Record<string, string | number> = {
			clientProtocol: input.client.protocol,
			clientBuild: input.client.build,
		};
		if (input.daemon !== undefined) {
			context["daemonProtocol"] = input.daemon.protocol;
			context["daemonBuild"] = input.daemon.build;
		}
		super({
			code: "manager_identity_mismatch",
			message: input.message,
			retryable: false,
			context,
		});
	}
}

class SessionManagerProtocolError extends PlotBoundaryError {
	override readonly name = "SessionManagerProtocolError";

	constructor(message: string, phase: "request" | "response") {
		super({
			code: "manager_protocol_error",
			message,
			retryable: false,
			context: { phase },
		});
	}
}

const managerIdentity = (
	options: SessionManagerIpcOptions,
): SessionManagerIdentity => ({
	protocol: sessionManagerProtocolVersion,
	build: options.identity ?? "development",
});

type ManagerRequest =
	| { readonly type: "hello" }
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
	| {
			readonly type: "error";
			readonly ok: false;
			readonly error: BoundaryErrorRecord;
	  }
	| { readonly type: "events-ready"; readonly session: SessionSummary }
	| { readonly type: "event"; readonly event: RuntimeEvent };

const limits = { maxLineBytes: 2 * 1024 * 1024 } as const;
const directoryMode = 0o700;
const socketMode = 0o600;
const daemonShutdownMs = 45_000;

const invalid = (label: string, phase: "request" | "response"): never => {
	throw new SessionManagerProtocolError(`Invalid ${label}`, phase);
};

const string = (
	value: unknown,
	label: string,
	phase: "request" | "response",
): string =>
	typeof value === "string" && value.length > 0 ? value : invalid(label, phase);

const object = <A>(
	value: unknown,
	label: string,
	phase: "request" | "response" = "response",
): A => (isRecord(value) ? (value as A) : invalid(label, phase));

const decodeRequest = (value: unknown): ManagerRequest => {
	if (!isRecord(value)) return invalid("Session Manager request", "request");
	const type = value["type"];
	if (type === "hello" || type === "list") return { type };
	if (type === "start") {
		const request: {
			type: "start";
			cwd: string;
			workflowPath?: string;
		} = { type, cwd: string(value["cwd"], "start cwd", "request") };
		if (value["workflowPath"] !== undefined)
			request.workflowPath = string(
				value["workflowPath"],
				"workflowPath",
				"request",
			);
		return request;
	}
	if (type === "find" || type === "stop")
		return {
			type,
			workflowPath: string(value["workflowPath"], "workflowPath", "request"),
		};
	if (type === "get" || type === "stop-session")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
		};
	if (type === "events") {
		const after = value["after"];
		if (typeof after !== "number" || !Number.isInteger(after) || after < 0)
			return invalid("event sequence", "request");
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
			after,
		};
	}
	if (type === "tick" || type === "pause" || type === "resume")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
		};
	if (type === "interrupt")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
			input: object<InterruptAgentRunInput>(
				value["input"],
				"interrupt input",
				"request",
			),
		};
	if (type === "observe")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
			input: object<OperatorObservationInput>(
				value["input"],
				"observe input",
				"request",
			),
		};
	if (type === "source-action")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
			input: object<SourceActionInput>(
				value["input"],
				"Source action input",
				"request",
			),
		};
	if (type === "source-action-cancel")
		return {
			type,
			sessionId: string(value["sessionId"], "sessionId", "request"),
			actionRunId: string(value["actionRunId"], "actionRunId", "request"),
		};
	return invalid("Session Manager request type", "request");
};

const decodeResponse = (value: unknown): ManagerResponse => {
	if (!isRecord(value)) return invalid("Session Manager response", "response");
	if (value["type"] === "result" && value["ok"] === true)
		return { type: "result", ok: true, value: value["value"] };
	if (value["type"] === "error" && value["ok"] === false)
		return {
			type: "error",
			ok: false,
			error: parseBoundaryErrorRecord(value["error"]),
		};
	if (value["type"] === "events-ready")
		return {
			type: "events-ready",
			session: parseSessionSummary(value["session"]),
		};
	if (value["type"] === "event" && isRecord(value["event"]))
		return { type: "event", event: value["event"] as unknown as RuntimeEvent };
	return invalid("Session Manager response type", "response");
};

const boundaryError = (record: BoundaryErrorRecord): PlotBoundaryError => {
	if (
		record.code === "session_not_found" &&
		typeof record.context?.["sessionId"] === "string"
	)
		return new SessionNotFoundError(record.context["sessionId"]);
	if (
		record.code === "session_not_controllable" &&
		typeof record.context?.["sessionId"] === "string" &&
		typeof record.context["state"] === "string" &&
		typeof record.context["operation"] === "string"
	)
		return new SessionNotControllableError({
			sessionId: record.context["sessionId"],
			state: record.context["state"] as SessionState,
			operation: record.context["operation"] as SessionControlOperation,
		});
	if (
		record.code === "workflow_invalid" &&
		(record.context?.["phase"] === "read" ||
			record.context?.["phase"] === "parse" ||
			record.context?.["phase"] === "prepare")
	) {
		const input: {
			phase: "read" | "parse" | "prepare";
			message: string;
			path?: string;
		} = { phase: record.context["phase"], message: record.message };
		if (typeof record.context["path"] === "string")
			input.path = record.context["path"];
		return new WorkflowBoundaryError(input);
	}
	return boundaryErrorFromRecord(record);
};

const managerDir = (options: SessionManagerIpcOptions): string =>
	resolve(options.managerDir ?? join(homedir(), ".plot", "session-manager"));

export const resolveSessionManagerSocket = (
	options: SessionManagerIpcOptions = {},
): string => join(managerDir(options), "manager.sock");

const write = (socket: { write: (text: string) => void }, value: unknown) =>
	socket.write(stringifyJsonl(value, limits));

const writeError = (socket: Socket, error: unknown, boundary: string) => {
	if (socket.destroyed) return;
	write(socket, {
		type: "error",
		ok: false,
		error: toBoundaryErrorRecord(error, boundary),
	});
};

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
		case "hello":
			throw new Error("hello is handled by the Session Manager server");
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
	readonly close: () => Promise<void>;
}> => {
	const socketPath = resolveSessionManagerSocket(input.options);
	await mkdir(dirname(socketPath), { recursive: true, mode: directoryMode });
	if (process.platform !== "win32")
		await chmod(dirname(socketPath), directoryMode);
	await removeStaleSocket(socketPath);
	const manager = input.manager ?? createManager(input.options);
	await manager.recoverAfterRestart();
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.once("close", () => sockets.delete(socket));
		void (async () => {
			for await (const line of jsonlLines(socket, limits)) {
				let request: ManagerRequest;
				try {
					request = decodeRequest(parseJsonl(line));
				} catch (error) {
					writeError(socket, error, "session-manager-request");
					return;
				}
				if (request.type === "hello") {
					write(socket, {
						type: "result",
						ok: true,
						value: managerIdentity(input.options),
					});
					socket.end();
					return;
				}
				if (request.type === "events") {
					const session = await manager.get(request.sessionId);
					if (session === undefined) {
						writeError(
							socket,
							new SessionNotFoundError(request.sessionId),
							"session-manager-events",
						);
						socket.end();
						return;
					}
					write(socket, { type: "events-ready", session });
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
					writeError(socket, error, "session-manager-runtime");
				}
				return;
			}
		})().catch((error) => {
			writeError(socket, error, "session-manager-connection");
			socket.end();
		});
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(socketPath, resolveListen);
	});
	if (process.platform !== "win32") await chmod(socketPath, socketMode);
	let closing: Promise<void> | undefined;
	const close = (): Promise<void> => {
		closing ??= new Promise((resolveClose) => {
			server.close(() => resolveClose());
			for (const socket of sockets) socket.destroy();
		});
		return closing;
	};
	return { manager, server, socketPath, close };
};

const request = async (
	options: SessionManagerIpcOptions,
	value: ManagerRequest,
	verifyIdentity = true,
): Promise<unknown> => {
	if (verifyIdentity && value.type !== "hello")
		await verifyManagerIdentity(options);
	const socket = createConnection(resolveSessionManagerSocket(options));
	try {
		await new Promise<void>((resolveConnect, reject) => {
			socket.once("connect", resolveConnect);
			socket.once("error", reject);
		});
		write(socket, value);
		for await (const line of jsonlLines(socket, limits)) {
			const response = decodeResponse(parseJsonl(line));
			if (response.type === "error") throw boundaryError(response.error);
			if (response.type === "result") return response.value;
		}
		throw new SessionManagerProtocolError(
			"Session Manager closed before responding",
			"response",
		);
	} finally {
		socket.destroy();
	}
};

const verifyManagerIdentity = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	const client = managerIdentity(options);
	let response: unknown;
	try {
		response = await request(options, { type: "hello" }, false);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ECONNREFUSED" || code === "ECONNRESET")
			throw error;
		throw new SessionManagerIdentityError({
			client,
			message: `Session Manager does not support client ${client.protocol}/${client.build}: ${errorMessage(error)}`,
		});
	}
	const value = object<Record<string, unknown>>(
		response,
		"Session Manager identity",
	);
	const daemonProtocol = value["protocol"];
	const daemonBuild = value["build"];
	if (typeof daemonProtocol !== "number" || typeof daemonBuild !== "string")
		throw new SessionManagerIdentityError({
			client,
			message: `Session Manager identity mismatch: client ${client.protocol}/${client.build}, daemon ${String(daemonProtocol)}/${String(daemonBuild)}`,
		});
	const daemon = { protocol: daemonProtocol, build: daemonBuild };
	if (daemon.protocol !== client.protocol || daemon.build !== client.build)
		throw new SessionManagerIdentityError({
			client,
			daemon,
			message: `Session Manager identity mismatch: client ${client.protocol}/${client.build}, daemon ${daemon.protocol}/${daemon.build}`,
		});
};

const sessionValue = (value: unknown): SessionSummary | undefined =>
	value === undefined ? undefined : parseSessionSummary(value);

export const createSessionManagerClient = (
	options: SessionManagerIpcOptions = {},
): SessionManagerRuntime => {
	const verify = (): Promise<void> => verifyManagerIdentity(options);
	const ask = async (value: ManagerRequest): Promise<unknown> => {
		await verify();
		return request(options, value, false);
	};
	const stoppingWorkflows = new Map<
		string,
		Promise<SessionSummary | undefined>
	>();
	const stoppingSessions = new Map<
		string,
		Promise<SessionSummary | undefined>
	>();
	const stop = (
		key: string,
		pending: Map<string, Promise<SessionSummary | undefined>>,
		message: ManagerRequest,
	): Promise<SessionSummary | undefined> => {
		const current = pending.get(key);
		if (current !== undefined) return current;
		const operation = ask(message).then(sessionValue);
		pending.set(key, operation);
		const finish = () => {
			if (pending.get(key) === operation) pending.delete(key);
		};
		void operation.then(finish, finish);
		return operation;
	};
	return {
		start: async (input) => {
			const value = object<Record<string, unknown>>(
				await ask({ type: "start", ...input }),
				"start result",
			);
			return {
				session: parseSessionSummary(value["session"]),
				started: value["started"] === true,
			};
		},
		find: async (workflowPath) =>
			sessionValue(await ask({ type: "find", workflowPath })),
		get: async (sessionId) =>
			sessionValue(await ask({ type: "get", sessionId })),
		stop: (workflowPath) =>
			stop(workflowPath, stoppingWorkflows, { type: "stop", workflowPath }),
		stopSession: (sessionId) =>
			stop(sessionId, stoppingSessions, { type: "stop-session", sessionId }),
		list: async () => {
			const value = await ask({ type: "list" });
			if (!Array.isArray(value))
				throw new SessionManagerProtocolError(
					"Invalid Session list",
					"response",
				);
			return value.map(parseSessionSummary);
		},
		events: (sessionId, after = 0, signal) => ({
			async *[Symbol.asyncIterator]() {
				await verify();
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
						if (response.type === "error") throw boundaryError(response.error);
						if (response.type === "event") yield response.event;
					}
				} finally {
					signal?.removeEventListener("abort", abort);
					socket.destroy();
				}
			},
		}),
		tick: async (sessionId) => {
			await ask({ type: "tick", sessionId });
		},
		pause: async (sessionId) => {
			await ask({ type: "pause", sessionId });
		},
		resume: async (sessionId) => {
			await ask({ type: "resume", sessionId });
		},
		interrupt: async (sessionId, input) =>
			(await ask({ type: "interrupt", sessionId, input })) === true,
		observe: async (sessionId, input) =>
			(await ask({ type: "observe", sessionId, input })) === true,
		startSourceAction: async (sessionId, input) =>
			(await ask({
				type: "source-action",
				sessionId,
				input,
			})) as SourceActionStartResult,
		cancelSourceAction: async (sessionId, actionRunId) =>
			(await ask({
				type: "source-action-cancel",
				sessionId,
				actionRunId,
			})) === true,
		shutdown: async () => {},
	};
};

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
			if (error instanceof SessionManagerIdentityError) throw error;
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
	try {
		await Promise.race([waitForManager(options), failed]);
	} catch (error) {
		// Another matching CLI may have won the daemon startup race.
		try {
			await waitForManager(options, 1_000);
		} catch {
			throw error;
		}
	}
};

export const openSessionManager = async (
	options: SessionManagerIpcOptions,
): Promise<SessionManagerRuntime> => {
	try {
		await request(options, { type: "list" });
	} catch (error) {
		if (error instanceof SessionManagerIdentityError) throw error;
		await startManagerDaemon(options);
	}
	return createSessionManagerClient(options);
};

export const runSessionManagerDaemon = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	const started = await startSessionManagerServer({ options });
	await new Promise<void>((resolveSignal) => {
		process.once("SIGINT", resolveSignal);
		process.once("SIGTERM", resolveSignal);
	});
	const shutdown = (async () => {
		const closing = started.close();
		await started.manager.shutdown();
		await closing;
	})();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			shutdown,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Session Manager shutdown timed out")),
					daemonShutdownMs,
				);
			}),
		]);
	} catch (error) {
		started.manager.forceClose();
		throw error;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (existsSync(started.socketPath)) unlinkSync(started.socketPath);
	}
};
