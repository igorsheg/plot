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
import {
	decodeOperatorObservation,
	decodeRuntimeEvent,
	decodeSourceActionInput,
	type OperatorObservationInput,
	type RuntimeEvent,
	type SourceActionInput,
	type SourceActionStartResult,
} from "@plot/session/runtime";
import { workflowBoundaryErrorFromRecord } from "@plot/session/workflow";
import {
	SessionManager,
	SessionNotControllableError,
	SessionNotFoundError,
	type SessionControlOperation,
	type SessionManagerClient,
} from "./manager.js";
import { createFileSessionStore } from "./session-store.js";
import {
	parseSessionSummary,
	type SessionState,
	type SessionSummary,
} from "./session.js";

export const sessionManagerProtocolVersion = 3;

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

const identity = (
	options: SessionManagerIpcOptions,
): SessionManagerIdentity => ({
	protocol: sessionManagerProtocolVersion,
	build: options.identity ?? "development",
});

type ManagerCommand =
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
	| { readonly type: "tick"; readonly sessionId: string }
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

interface ManagerRequest {
	readonly identity: SessionManagerIdentity;
	readonly command: ManagerCommand;
}

type ManagerResponse =
	| { readonly type: "result"; readonly ok: true; readonly value?: unknown }
	| {
			readonly type: "error";
			readonly ok: false;
			readonly error: BoundaryErrorRecord;
	  }
	| { readonly type: "event"; readonly event: RuntimeEvent };

const limits = { maxLineBytes: 2 * 1024 * 1024 } as const;
const directoryMode = 0o700;
const socketMode = 0o600;
const daemonShutdownMs = 45_000;

const invalid = (label: string, phase: "request" | "response"): never => {
	throw new Error(`Invalid ${phase} ${label}`);
};

const text = (
	value: unknown,
	label: string,
	phase: "request" | "response",
): string =>
	typeof value === "string" && value.length > 0 ? value : invalid(label, phase);

const record = (
	value: unknown,
	label: string,
	phase: "request" | "response" = "response",
): Record<string, unknown> => (isRecord(value) ? value : invalid(label, phase));

const decodeIdentity = (value: unknown): SessionManagerIdentity => {
	const input = record(value, "Session Manager identity", "request");
	if (typeof input["protocol"] !== "number")
		return invalid("identity protocol", "request");
	return {
		protocol: input["protocol"],
		build: text(input["build"], "identity build", "request"),
	};
};

const decodeCommand = (value: unknown): ManagerCommand => {
	const input = record(value, "Session Manager command", "request");
	const type = input["type"];
	if (type === "list") return { type };
	if (type === "start") {
		const command: Extract<ManagerCommand, { type: "start" }> = {
			type,
			cwd: text(input["cwd"], "start cwd", "request"),
		};
		if (input["workflowPath"] === undefined) return command;
		return {
			...command,
			workflowPath: text(input["workflowPath"], "workflowPath", "request"),
		};
	}
	if (type === "find" || type === "stop")
		return {
			type,
			workflowPath: text(input["workflowPath"], "workflowPath", "request"),
		};
	if (type === "get" || type === "stop-session" || type === "tick")
		return {
			type,
			sessionId: text(input["sessionId"], "sessionId", "request"),
		};
	if (type === "events") {
		const after = input["after"];
		if (typeof after !== "number" || !Number.isInteger(after) || after < 0)
			return invalid("event sequence", "request");
		return {
			type,
			sessionId: text(input["sessionId"], "sessionId", "request"),
			after,
		};
	}
	if (type === "observe")
		return {
			type,
			sessionId: text(input["sessionId"], "sessionId", "request"),
			input: decodeOperatorObservation(input["input"]),
		};
	if (type === "source-action")
		return {
			type,
			sessionId: text(input["sessionId"], "sessionId", "request"),
			input: decodeSourceActionInput(input["input"]),
		};
	if (type === "source-action-cancel")
		return {
			type,
			sessionId: text(input["sessionId"], "sessionId", "request"),
			actionRunId: text(input["actionRunId"], "actionRunId", "request"),
		};
	return invalid("Session Manager command type", "request");
};

const decodeRequest = (value: unknown): ManagerRequest => {
	const input = record(value, "Session Manager request", "request");
	return {
		identity: decodeIdentity(input["identity"]),
		command: decodeCommand(input["command"]),
	};
};

const decodeResponse = (value: unknown): ManagerResponse => {
	const input = record(value, "Session Manager response");
	if (input["type"] === "result" && input["ok"] === true)
		return { type: "result", ok: true, value: input["value"] };
	if (input["type"] === "error" && input["ok"] === false)
		return {
			type: "error",
			ok: false,
			error: parseBoundaryErrorRecord(input["error"]),
		};
	if (input["type"] === "event")
		return { type: "event", event: decodeRuntimeEvent(input["event"]) };
	return invalid("Session Manager response type", "response");
};

const boundaryError = (error: BoundaryErrorRecord): PlotBoundaryError => {
	if (
		error.code === "manager_identity_mismatch" &&
		typeof error.context?.["clientProtocol"] === "number" &&
		typeof error.context["clientBuild"] === "string"
	) {
		const client = {
			protocol: error.context["clientProtocol"],
			build: error.context["clientBuild"],
		};
		if (
			typeof error.context["daemonProtocol"] === "number" &&
			typeof error.context["daemonBuild"] === "string"
		)
			return new SessionManagerIdentityError({
				message: error.message,
				client,
				daemon: {
					protocol: error.context["daemonProtocol"],
					build: error.context["daemonBuild"],
				},
			});
		return new SessionManagerIdentityError({ message: error.message, client });
	}
	if (
		error.code === "session_not_found" &&
		typeof error.context?.["sessionId"] === "string"
	)
		return new SessionNotFoundError(error.context["sessionId"]);
	if (
		error.code === "session_not_controllable" &&
		typeof error.context?.["sessionId"] === "string" &&
		typeof error.context["state"] === "string" &&
		typeof error.context["operation"] === "string"
	)
		return new SessionNotControllableError({
			sessionId: error.context["sessionId"],
			state: error.context["state"] as SessionState,
			operation: error.context["operation"] as SessionControlOperation,
		});
	const workflow = workflowBoundaryErrorFromRecord(error);
	if (workflow !== undefined) return workflow;
	return boundaryErrorFromRecord(error);
};

const managerDir = (options: SessionManagerIpcOptions): string =>
	resolve(options.managerDir ?? join(homedir(), ".plot", "session-manager"));

export const resolveSessionManagerSocket = (
	options: SessionManagerIpcOptions = {},
): string => join(managerDir(options), "manager.sock");

const write = (socket: { write: (text: string) => void }, value: unknown) =>
	socket.write(stringifyJsonl(value, limits));

const writeError = (socket: Socket, error: unknown, owner: string) => {
	if (socket.destroyed) return;
	write(socket, {
		type: "error",
		ok: false,
		error: toBoundaryErrorRecord(error, owner),
	});
};

const createManager = (options: SessionManagerIpcOptions): SessionManager => {
	if (options.cli === undefined)
		throw new Error("Session Manager requires the Plot executable");
	return new SessionManager({
		store: createFileSessionStore(join(managerDir(options), "sessions.json")),
		cli: options.cli,
	});
};

const execute = (
	manager: SessionManagerClient,
	command: Exclude<ManagerCommand, { type: "events" }>,
): Promise<unknown> => {
	switch (command.type) {
		case "start":
			return manager.start(command);
		case "find":
			return manager.find(command.workflowPath);
		case "get":
			return manager.get(command.sessionId);
		case "stop":
			return manager.stop(command.workflowPath);
		case "stop-session":
			return manager.stopSession(command.sessionId);
		case "list":
			return manager.list();
		case "tick":
			return manager.tick(command.sessionId);
		case "observe":
			return manager.observe(command.sessionId, command.input);
		case "source-action":
			return manager.startSourceAction(command.sessionId, command.input);
		case "source-action-cancel":
			return manager.cancelSourceAction(command.sessionId, command.actionRunId);
	}
};

const assertIdentity = (
	client: SessionManagerIdentity,
	options: SessionManagerIpcOptions,
) => {
	const daemon = identity(options);
	if (client.protocol !== daemon.protocol || client.build !== daemon.build)
		throw new SessionManagerIdentityError({
			client,
			daemon,
			message: `Session Manager identity mismatch: client ${client.protocol}/${client.build}, daemon ${daemon.protocol}/${daemon.build}`,
		});
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
					assertIdentity(request.identity, input.options);
				} catch (error) {
					writeError(socket, error, "session-manager-request");
					socket.end();
					return;
				}
				if (request.command.type === "events") {
					const controller = new AbortController();
					const abort = () => controller.abort();
					socket.once("close", abort);
					try {
						for await (const event of manager.events(
							request.command.sessionId,
							request.command.after,
							controller.signal,
						))
							write(socket, { type: "event", event });
					} catch (error) {
						writeError(socket, error, "session-manager-events");
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
						value: await execute(manager, request.command),
					});
				} catch (error) {
					writeError(socket, error, "session-manager-runtime");
				}
				socket.end();
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

const connect = async (options: SessionManagerIpcOptions): Promise<Socket> => {
	const socket = createConnection(resolveSessionManagerSocket(options));
	await new Promise<void>((resolveConnect, reject) => {
		socket.once("connect", resolveConnect);
		socket.once("error", reject);
	});
	return socket;
};

const request = async (
	options: SessionManagerIpcOptions,
	command: ManagerCommand,
): Promise<unknown> => {
	const socket = await connect(options);
	try {
		write(socket, { identity: identity(options), command });
		for await (const line of jsonlLines(socket, limits)) {
			const response = decodeResponse(parseJsonl(line));
			if (response.type === "error") throw boundaryError(response.error);
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
): SessionManagerClient => ({
	start: async (input) => {
		const value = record(
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
		if (!Array.isArray(value)) throw new Error("Invalid Session list");
		return value.map(parseSessionSummary);
	},
	events: (sessionId, after = 0, signal) => ({
		async *[Symbol.asyncIterator]() {
			if (signal?.aborted) return;
			const socket = await connect(options);
			const abort = () => socket.destroy();
			signal?.addEventListener("abort", abort, { once: true });
			try {
				write(socket, {
					identity: identity(options),
					command: { type: "events", sessionId, after },
				});
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
		await request(options, { type: "tick", sessionId });
	},
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
			await request(options, { type: "list" });
			return;
		} catch (error) {
			if (error instanceof SessionManagerIdentityError) throw error;
			lastError = error;
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
		try {
			await waitForManager(options, 1_000);
		} catch {
			throw error;
		}
	}
};

export const openSessionManager = async (
	options: SessionManagerIpcOptions,
): Promise<SessionManagerClient> => {
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
