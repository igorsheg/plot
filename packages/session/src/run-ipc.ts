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
import { jsonlLines, stringifyJsonl } from "./jsonl.js";
import { errorMessage } from "./primitives.js";
import {
	defaultProtocolLimits,
	serverRecordSchema,
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

const write = (socket: { write: (text: string) => void }, response: unknown) =>
	socket.write(stringifyJsonl(response, { maxLineBytes: 2 * 1024 * 1024 }));

const makeRunRegistry = (options: RunIpcOptions): RunRegistry => {
	const runRegistryDir = resolveRunIpcDir(options);
	return new RunRegistry({
		cwd: options.cwd,
		store: createFileRunStore(join(runRegistryDir, "runs.json")),
		...(options.cli === undefined ? {} : { cli: options.cli }),
	});
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
	if (existsSync(socketPath)) unlinkSync(socketPath);
	const runRegistry = input.runRegistry ?? makeRunRegistry(input.options);
	await runRegistry.recoverAfterRestart();
	const server = createServer((socket) => {
		let buffer = "";
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
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			void (async () => {
				for (;;) {
					const index = buffer.indexOf("\n");
					if (index === -1) return;
					const line = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					if (line === "") continue;
					const request = decodeRunRequest(JSON.parse(line) as unknown);
					if (request.type === "protocol_stream") {
						// eslint-disable-next-line no-await-in-loop -- stream requests take over this socket.
						await streamRecords(request);
						return;
					}
					// eslint-disable-next-line no-await-in-loop -- socket requests are handled in wire order.
					write(socket, await handleRequest(runRegistry, request));
				}
			})().catch((error) =>
				write(socket, { type: "error", ok: false, error: errorMessage(error) }),
			);
		});
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
): Promise<RunResponse> =>
	new Promise((resolve, reject) => {
		const socket = createConnection(resolveRunIpcSocketPath(options));
		let buffer = "";
		socket.on("connect", () => write(socket, request));
		socket.on("error", reject);
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			const index = buffer.indexOf("\n");
			if (index === -1) return;
			resolve(decodeRunResponse(JSON.parse(buffer.slice(0, index)) as unknown));
			socket.end();
		});
	});

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
			return serverRecordSchema.parse(response.record);
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
					const response = decodeRunResponse(JSON.parse(line) as unknown);
					const error = responseError(response);
					if (error !== undefined) throw error;
					if (response.type === "protocol_ready") {
						if (response.run === undefined) throw runMissing(id);
						continue;
					}
					if (response.type === "protocol_response")
						yield serverRecordSchema.parse(response.record);
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
	readonly owned: boolean;
	readonly close: () => Promise<void>;
}> => {
	try {
		await sendRunIpcRequest(options, { type: "list" });
		return {
			runRegistry: createRunIpcClient(options),
			socketPath: resolveRunIpcSocketPath(options),
			owned: false,
			close: async () => {},
		};
	} catch {
		const server = await startRunIpcServer({ options });
		return {
			runRegistry: server.runRegistry,
			socketPath: server.socketPath,
			owned: true,
			close: async () => {
				server.server.close();
				await server.runRegistry.shutdown();
				if (existsSync(server.socketPath)) unlinkSync(server.socketPath);
			},
		};
	}
};
