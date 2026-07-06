import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
	RunRegistry,
	createFileRunStore,
	decodeRunRequest,
	decodeRunResponse,
	type RunRecord,
	type RunRegistryRuntime,
	type RunRequest,
	type RunResponse,
	type RunSpawnOptions,
} from "./run-registry.js";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage } from "@plot/common/primitives";
import {
	decodeServerRecord,
	defaultProtocolLimits,
	type ClientRequest,
	type ServerRecord,
} from "./protocol.js";

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

const write = (socket: { write: (text: string) => void }, response: unknown) =>
	socket.write(stringifyJsonl(response, runIpcLimits));

const makeRunRegistry = (options: RunIpcOptions): RunRegistry => {
	const runRegistryDir = resolveRunIpcDir(options);
	return new RunRegistry({
		cwd: options.cwd,
		store: createFileRunStore(join(runRegistryDir, "runs.json")),
		historyDir: runHistoryDir(runRegistryDir),
		...(options.cli === undefined ? {} : { cli: options.cli }),
	});
};

/** Session History lives beside the registry store; readers read it directly. */
export const runHistoryDir = (runRegistryDir: string): string =>
	join(runRegistryDir, "history");

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
			return decodeServerRecord(response.record);
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
					if (response.type === "protocol_response")
						yield decodeServerRecord(response.record);
				}
			} finally {
				socket.end();
			}
		},
		shutdown: async () => {},
	};
};

export const openRunIpc = async (
	options: RunIpcOptions,
): Promise<{
	readonly runRegistry: RunRegistryRuntime;
	readonly socketPath: string;
	readonly historyDir: string;
	readonly owned: boolean;
	readonly close: () => Promise<void>;
}> => {
	await sendRunIpcRequest(options, { type: "list" });
	return {
		runRegistry: createRunIpcClient(options),
		socketPath: resolveRunIpcSocketPath(options),
		historyDir: runHistoryDir(resolveRunIpcDir(options)),
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
			"run registry daemon is not running; run `plot registry serve`",
		);
	const args = [
		...options.cli.args,
		"registry",
		"serve",
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
	readonly historyDir: string;
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
