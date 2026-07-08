import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
	RunRegistry,
	type RunRegistryRuntime,
	type RunSpawnOptions,
} from "./supervisor.js";
import { createFileRunStore } from "./store.js";
import { parseRunRecord, type RunRecord } from "./record.js";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, isRecord, type Mutable } from "@plot/common/primitives";
import {
	decodeClientRequest,
	decodeServerRecord,
	defaultProtocolLimits,
	type ClientRequest,
	type ServerRecord,
} from "@plot/session/protocol";
import { runEventRecords } from "./events.js";

export type RunRequest =
	| { readonly type: "spawn"; readonly options?: RunSpawnOptions }
	| { readonly type: "list" }
	| { readonly type: "status"; readonly id: string }
	| { readonly type: "stop"; readonly id: string }
	| { readonly type: "prune" }
	| {
			readonly type: "protocol_stream";
			readonly id: string;
			readonly afterSequence?: number;
	  }
	| {
			readonly type: "protocol_request";
			readonly id: string;
			readonly request: ClientRequest;
	  };

export type RunResponse =
	| {
			readonly type: "spawn_result";
			readonly ok: true;
			readonly run: RunRecord;
	  }
	| {
			readonly type: "list_result";
			readonly ok: true;
			readonly runs: readonly RunRecord[];
	  }
	| {
			readonly type: "status_result";
			readonly ok: true;
			readonly run?: RunRecord;
	  }
	| {
			readonly type: "stop_result";
			readonly ok: true;
			readonly id: string;
			readonly run?: RunRecord;
	  }
	| {
			readonly type: "prune_result";
			readonly ok: true;
			readonly removed: readonly RunRecord[];
	  }
	| {
			readonly type: "protocol_ready";
			readonly ok: true;
			readonly run?: RunRecord;
	  }
	| { readonly type: "protocol_response"; readonly record: ServerRecord }
	| { readonly type: "error"; readonly ok: false; readonly error: string };

const decodeError = (label: string, value: unknown): Error =>
	new Error(`invalid ${label}: ${JSON.stringify(value)?.slice(0, 200)}`);

const nonEmptyString = (
	label: string,
	value: unknown,
	input: unknown,
): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw decodeError(label, input);
};

const optionalRunRecord = (value: unknown): RunRecord | undefined =>
	value === undefined ? undefined : parseRunRecord(value);

const decodeSpawnOptions = (value: unknown): RunSpawnOptions | undefined => {
	if (value === undefined) return undefined;
	if (!isRecord(value)) throw decodeError("spawn options", value);
	const options: Mutable<RunSpawnOptions> = {};
	for (const key of ["cwd", "label", "sessionId", "workflowPath"] as const) {
		const field = value[key];
		if (typeof field === "string" && field.length > 0) options[key] = field;
	}
	return options;
};

const decodeAfterSequence = (
	value: unknown,
	input: unknown,
): number | undefined => {
	if (value === undefined) return undefined;
	if (typeof value === "number" && Number.isInteger(value) && value >= 0)
		return value;
	throw decodeError("run IPC afterSequence", input);
};

export const decodeRunRequest = (value: unknown): RunRequest => {
	if (!isRecord(value)) throw decodeError("run request", value);
	const type = value["type"];
	if (type === "list" || type === "prune") return { type };
	if (type === "spawn") {
		const options = decodeSpawnOptions(value["options"]);
		return options === undefined ? { type } : { type, options };
	}
	if (type === "status" || type === "stop")
		return { type, id: nonEmptyString("run IPC id", value["id"], value) };
	if (type === "protocol_stream") {
		const request: Mutable<Extract<RunRequest, { type: "protocol_stream" }>> = {
			type,
			id: nonEmptyString("run IPC id", value["id"], value),
		};
		const afterSequence = decodeAfterSequence(value["afterSequence"], value);
		if (afterSequence !== undefined) request.afterSequence = afterSequence;
		return request;
	}
	if (type === "protocol_request")
		return {
			type,
			id: nonEmptyString("run IPC id", value["id"], value),
			request: decodeClientRequest(value["request"]),
		};
	throw decodeError("run request", value);
};

export const decodeRunResponse = (value: unknown): RunResponse => {
	if (!isRecord(value)) throw decodeError("run response", value);
	const type = value["type"];
	if (type === "error") {
		if (value["ok"] !== false) throw decodeError("run error response", value);
		return {
			type,
			ok: false,
			error: nonEmptyString("run IPC error", value["error"], value),
		};
	}
	if (value["ok"] !== true && type !== "protocol_response")
		throw decodeError("run response", value);
	if (type === "spawn_result")
		return { type, ok: true, run: parseRunRecord(value["run"]) };
	if (type === "list_result") {
		if (!Array.isArray(value["runs"]))
			throw decodeError("run list response", value);
		return { type, ok: true, runs: value["runs"].map(parseRunRecord) };
	}
	if (type === "status_result") {
		const response: Mutable<Extract<RunResponse, { type: "status_result" }>> = {
			type,
			ok: true,
		};
		const run = optionalRunRecord(value["run"]);
		if (run !== undefined) response.run = run;
		return response;
	}
	if (type === "stop_result") {
		const response: Mutable<Extract<RunResponse, { type: "stop_result" }>> = {
			type,
			ok: true,
			id: nonEmptyString("run IPC id", value["id"], value),
		};
		const run = optionalRunRecord(value["run"]);
		if (run !== undefined) response.run = run;
		return response;
	}
	if (type === "prune_result") {
		if (!Array.isArray(value["removed"]))
			throw decodeError("run prune response", value);
		return { type, ok: true, removed: value["removed"].map(parseRunRecord) };
	}
	if (type === "protocol_ready") {
		const response: Mutable<Extract<RunResponse, { type: "protocol_ready" }>> =
			{
				type,
				ok: true,
			};
		const run = optionalRunRecord(value["run"]);
		if (run !== undefined) response.run = run;
		return response;
	}
	if (type === "protocol_response")
		return { type, record: decodeServerRecord(value["record"]) };
	throw decodeError("run response", value);
};

export interface RunIpcOptions {
	readonly cwd: string;
	readonly runRegistryDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
}

const resolveRunIpcDir = (options: RunIpcOptions): string =>
	resolvePath(
		options.runRegistryDir ?? join(homedir(), ".plot", "runRegistry"),
	);

export const resolveRunIpcSocketPath = (options: RunIpcOptions): string =>
	join(resolveRunIpcDir(options), "runRegistry.sock");

const runIpcLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;
const RUN_IPC_DIR_MODE = 0o700;
const RUN_IPC_SOCKET_MODE = 0o600;

const restrictPrivatePath = async (
	path: string,
	mode: number,
): Promise<void> => {
	if (process.platform === "win32") return;
	await chmod(path, mode);
};

const write = (socket: { write: (text: string) => void }, response: unknown) =>
	socket.write(stringifyJsonl(response, runIpcLimits));

const makeRunRegistry = (options: RunIpcOptions): RunRegistry => {
	const runRegistryDir = resolveRunIpcDir(options);
	const registryOptions: Mutable<ConstructorParameters<typeof RunRegistry>[0]> =
		{
			cwd: options.cwd,
			store: createFileRunStore(join(runRegistryDir, "runs.json")),
		};
	if (options.cli !== undefined) registryOptions.cli = options.cli;
	return new RunRegistry(registryOptions);
};

const handleRequest = async (runRegistry: RunRegistry, request: RunRequest) => {
	if (request.type === "list")
		return { type: "list_result", ok: true, runs: await runRegistry.list() };
	if (request.type === "spawn")
		return {
			type: "spawn_result",
			ok: true,
			run: await runRegistry.spawn(request.options),
		};
	if (request.type === "status")
		return {
			type: "status_result",
			ok: true,
			run: await runRegistry.status(request.id),
		};
	if (request.type === "stop")
		return {
			type: "stop_result",
			ok: true,
			id: request.id,
			run: await runRegistry.stop(request.id),
		};
	if (request.type === "prune")
		return {
			type: "prune_result",
			ok: true,
			removed: await runRegistry.prune(),
		};
	if (request.type === "protocol_request")
		return {
			type: "protocol_response",
			record: await runRegistry.submit(request.id, request.request),
		};
	return {
		type: "protocol_ready",
		ok: true,
		run: await runRegistry.status(request.id),
	};
};

const isSocketLive = (socketPath: string): Promise<boolean> =>
	new Promise<boolean>((resolve, reject) => {
		const socket = createConnection(socketPath);
		let settled = false;
		const finish = (value: boolean) => {
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			socket.destroy();
			resolve(value);
		};
		socket.on("connect", () => finish(true));
		socket.on("error", (error: NodeJS.ErrnoException) => {
			if (
				error.code === "ENOENT" ||
				error.code === "ECONNREFUSED" ||
				error.code === "ECONNRESET" ||
				error.code === "EPIPE"
			) {
				finish(false);
				return;
			}
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			socket.destroy();
			reject(error);
		});
	});

const removeStaleSocketIfNeeded = async (socketPath: string) => {
	if (!existsSync(socketPath)) return;
	if (await isSocketLive(socketPath))
		throw new Error(`run registry is already running: ${socketPath}`);
	unlinkSync(socketPath);
};

export const startRunIpcServer = async (input: {
	readonly options: RunIpcOptions;
	readonly runRegistry?: RunRegistry;
}): Promise<{
	readonly runRegistry: RunRegistry;
	readonly server: Server;
	readonly socketPath: string;
}> => {
	const socketPath = resolveRunIpcSocketPath(input.options);
	await mkdir(dirname(socketPath), { recursive: true });
	await restrictPrivatePath(dirname(socketPath), RUN_IPC_DIR_MODE);
	await removeStaleSocketIfNeeded(socketPath);
	const runRegistry = input.runRegistry ?? makeRunRegistry(input.options);
	await runRegistry.recoverAfterRestart();
	const server = createServer((socket) => {
		const streamRecords = async (
			request: Extract<RunRequest, { type: "protocol_stream" }>,
		) => {
			write(socket, await handleRequest(runRegistry, request));
			const records = runRegistry.attachRecords(
				request.id,
				request.afterSequence,
			);
			const iterator = records[Symbol.asyncIterator]();
			const closed = new Promise<"closed">((resolve) =>
				socket.once("close", () => resolve("closed")),
			);
			try {
				for (;;) {
					// eslint-disable-next-line no-await-in-loop -- stream emits records as they arrive or the socket closes.
					const next = await Promise.race([iterator.next(), closed]);
					if (next === "closed" || next.done === true) break;
					write(socket, { type: "protocol_response", record: next.value });
				}
			} finally {
				await iterator.return?.();
			}
		};
		void (async () => {
			for await (const line of jsonlLines(socket, runIpcLimits)) {
				const trimmed = line.trim();
				if (trimmed === "") continue;
				const request = decodeRunRequest(parseJsonl(trimmed));
				if (request.type === "protocol_stream") {
					await streamRecords(request);
					return;
				}
				write(socket, await handleRequest(runRegistry, request));
			}
		})().catch((error) =>
			write(socket, { type: "error", ok: false, error: errorMessage(error) }),
		);
	});
	const listen = () =>
		new Promise<void>((resolveListen, reject) => {
			server.once("error", reject);
			server.listen(socketPath, () => {
				server.off("error", reject);
				resolveListen();
			});
		});
	try {
		await listen();
	} catch (error) {
		if (!existsSync(socketPath)) throw error;
		unlinkSync(socketPath);
		await listen();
	}
	await restrictPrivatePath(socketPath, RUN_IPC_SOCKET_MODE);
	return { runRegistry, server, socketPath };
};

export const sendRunIpcRequest = async (
	options: RunIpcOptions,
	request: RunRequest,
): Promise<RunResponse> => {
	const socketPath = resolveRunIpcSocketPath(options);
	const socket = createConnection(socketPath);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.once("connect", resolve);
			socket.once("error", reject);
		});
		write(socket, request);
		for await (const line of jsonlLines(socket, runIpcLimits))
			return decodeRunResponse(parseJsonl(line));
		throw new Error(`run registry closed before response: ${socketPath}`);
	} finally {
		socket.destroy();
	}
};

const runMissing = (id: string) => new Error(`unknown run: ${id}`);

const responseError = (response: RunResponse): Error | undefined =>
	response.type === "error" ? new Error(response.error) : undefined;

/** Stream a run's live protocol records over the registry socket. */
export const streamRunRecords = (
	options: RunIpcOptions,
	runId: string,
	afterSequence = 0,
): AsyncIterable<ServerRecord> =>
	createRunIpcClient(options).attachRecords(runId, afterSequence);

/** Stream durable session events first, then continue with live protocol records. */
export async function* streamRunRecordsGapless(
	options: RunIpcOptions,
	runId: string,
	afterSequence = 0,
): AsyncIterable<ServerRecord> {
	const client = createRunIpcClient(options);
	const run = await client.status(runId);
	if (run === undefined) throw runMissing(runId);
	yield* runEventRecords({
		run,
		after: afterSequence,
		liveRecords: client.attachRecords(runId, afterSequence),
	});
}

export const createRunIpcClient = (
	options: RunIpcOptions,
): RunRegistryRuntime => {
	const request = async (value: RunRequest): Promise<RunResponse> => {
		const response = await sendRunIpcRequest(options, value);
		const error = responseError(response);
		if (error !== undefined) throw error;
		return response;
	};
	return {
		spawn: async (input?: RunSpawnOptions): Promise<RunRecord> => {
			const response = await request(
				input === undefined
					? { type: "spawn" }
					: { type: "spawn", options: input },
			);
			if (response.type !== "spawn_result")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.run;
		},
		list: async (): Promise<readonly RunRecord[]> => {
			const response = await request({ type: "list" });
			if (response.type !== "list_result")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.runs;
		},
		status: async (id: string): Promise<RunRecord | undefined> => {
			const response = await request({ type: "status", id });
			if (response.type !== "status_result")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.run;
		},
		stop: async (id: string): Promise<RunRecord | undefined> => {
			const response = await request({ type: "stop", id });
			if (response.type !== "stop_result")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.run;
		},
		prune: async (): Promise<readonly RunRecord[]> => {
			const response = await request({ type: "prune" });
			if (response.type !== "prune_result")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.removed;
		},
		submit: async (
			id: string,
			clientRequest: ClientRequest,
		): Promise<ServerRecord> => {
			const response = await request({
				type: "protocol_request",
				id,
				request: clientRequest,
			});
			if (response.type !== "protocol_response")
				throw new Error(`unexpected IPC response: ${response.type}`);
			return response.record;
		},
		attachRecords: async function* (
			id: string,
			afterSequence = 0,
		): AsyncIterable<ServerRecord> {
			const socket = createConnection(resolveRunIpcSocketPath(options));
			await new Promise<void>((resolveConnect, reject) => {
				socket.once("connect", resolveConnect);
				socket.once("error", reject);
			});
			write(socket, {
				type: "protocol_stream",
				id,
				afterSequence,
			});
			try {
				for await (const line of jsonlLines(socket, {
					maxLineBytes: defaultProtocolLimits.maxOutputLineBytes,
				})) {
					const response = decodeRunResponse(parseJsonl(line));
					const error = responseError(response);
					if (error !== undefined) throw error;
					if (response.type === "protocol_ready") {
						if (response.run === undefined) throw runMissing(id);
						continue;
					}
					if (response.type === "protocol_response") yield response.record;
				}
			} finally {
				socket.end();
			}
		},
		shutdown: async () => {},
	};
};

export interface RunRegistryDaemonHooks {
	readonly onReady?: (socketPath: string) => Promise<void> | void;
}

/** Run the registry daemon until SIGINT/SIGTERM; owns shutdown and socket cleanup. */
export const runRegistryDaemon = async (
	options: RunIpcOptions,
	hooks: RunRegistryDaemonHooks = {},
): Promise<void> => {
	const server = await startRunIpcServer({ options });
	await hooks.onReady?.(server.socketPath);
	let stopping = false;
	const shutdown = async () => {
		if (stopping) return;
		stopping = true;
		server.server.close();
		await server.runRegistry.shutdown();
		if (existsSync(server.socketPath)) unlinkSync(server.socketPath);
	};
	process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
	await new Promise<void>(() => {});
};

export const openRunIpc = async (
	options: RunIpcOptions,
): Promise<{
	readonly runRegistry: RunRegistryRuntime;
	readonly socketPath: string;

	readonly owned: boolean;
	readonly close: () => Promise<void>;
}> => {
	await sendRunIpcRequest(options, { type: "list" });
	return {
		runRegistry: createRunIpcClient(options),
		socketPath: resolveRunIpcSocketPath(options),

		owned: false,
		close: async () => {},
	};
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForRunIpc = async (
	options: RunIpcOptions,
	timeoutMs = 5_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() <= deadline) {
		try {
			// eslint-disable-next-line no-await-in-loop -- poll until the daemon accepts requests.
			await sendRunIpcRequest(options, { type: "list" });
			return;
		} catch (error) {
			lastError = error;
			// eslint-disable-next-line no-await-in-loop -- bounded retry delay.
			await sleep(50);
		}
	}
	throw new Error(`run registry did not start: ${errorMessage(lastError)}`);
};

export const startRunIpcDaemon = async (
	options: RunIpcOptions,
): Promise<void> => {
	if (options.cli === undefined)
		throw new Error(
			"run registry daemon is not running; run `plot serve registry`",
		);
	const args = [
		...options.cli.args,
		"serve",
		"registry",
		"--cwd",
		options.cwd,
		...(options.runRegistryDir === undefined
			? []
			: ["--registry-dir", options.runRegistryDir]),
	];
	const child = spawn(options.cli.command, args, {
		cwd: options.cwd,
		detached: true,
		stdio: "ignore",
	});
	const failed = new Promise<never>((_resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) =>
			reject(
				new Error(
					`run registry daemon exited before ready: ${signal ?? code ?? "unknown"}`,
				),
			),
		);
	});
	child.unref();
	await Promise.race([waitForRunIpc(options), failed]);
};

export const openOrStartRunIpc = async (
	options: RunIpcOptions,
): Promise<{
	readonly runRegistry: RunRegistryRuntime;
	readonly socketPath: string;

	readonly owned: boolean;
	readonly close: () => Promise<void>;
}> => {
	try {
		return await openRunIpc(options);
	} catch {
		await startRunIpcDaemon(options);
		return openRunIpc(options);
	}
};
