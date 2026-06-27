import { existsSync, unlinkSync } from "node:fs";
import {
	createConnection,
	createServer,
	type Server,
	type Socket,
} from "node:net";
import {
	decodePlotClientRecord,
	type PlotServerRecord,
} from "@plot/session/protocol";
import { resolvePlotSupervisorSocketPath } from "./plot-paths.js";
import {
	PlotSupervisor,
	type PlotInstanceRecord,
	type PlotSupervisorOptions,
	type PlotSupervisorSpawnOptions,
} from "./supervisor.js";

export type PlotSupervisorRequest =
	| { readonly type: "spawn"; readonly options?: PlotSupervisorSpawnOptions }
	| { readonly type: "list" }
	| { readonly type: "status"; readonly instanceId: string }
	| { readonly type: "stop"; readonly instanceId: string }
	| {
			readonly type: "protocol_stream";
			readonly instanceId: string;
			readonly afterSequence?: number;
	  };

export type PlotSupervisorResponse =
	| {
			readonly type: "spawn_result";
			readonly ok: true;
			readonly instance: PlotInstanceRecord;
	  }
	| {
			readonly type: "list_result";
			readonly ok: true;
			readonly instances: readonly PlotInstanceRecord[];
	  }
	| {
			readonly type: "status_result";
			readonly ok: true;
			readonly instance: PlotInstanceRecord;
	  }
	| {
			readonly type: "stop_result";
			readonly ok: true;
			readonly instanceId: string;
	  }
	| {
			readonly type: "protocol_ready";
			readonly ok: true;
			readonly instance: PlotInstanceRecord;
	  }
	| { readonly type: "protocol_response"; readonly record: PlotServerRecord }
	| { readonly type: "error"; readonly ok: false; readonly error: string };

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const unknownInstance = (id: string): PlotSupervisorResponse => ({
	type: "error",
	ok: false,
	error: `unknown instance: ${id}`,
});

const parseRequest = (input: string): PlotSupervisorRequest =>
	JSON.parse(input) as PlotSupervisorRequest;

const write = (socket: Socket, response: PlotSupervisorResponse): void => {
	socket.write(line(response));
};

const handleRequest = async (
	supervisor: PlotSupervisor,
	request: PlotSupervisorRequest,
): Promise<PlotSupervisorResponse> => {
	if (request.type === "spawn")
		return {
			type: "spawn_result",
			ok: true,
			instance: await supervisor.spawnInstance(request.options ?? {}),
		};
	if (request.type === "list")
		return {
			type: "list_result",
			ok: true,
			instances: supervisor.listInstances(),
		};
	if (request.type === "status") {
		const instance = supervisor.getInstance(request.instanceId);
		return instance === undefined
			? unknownInstance(request.instanceId)
			: { type: "status_result", ok: true, instance };
	}
	if (request.type === "stop") {
		const instance = await supervisor.stopInstance(request.instanceId);
		return instance === undefined
			? unknownInstance(request.instanceId)
			: { type: "stop_result", ok: true, instanceId: request.instanceId };
	}
	const instance = supervisor.getInstance(request.instanceId);
	return instance === undefined
		? unknownInstance(request.instanceId)
		: { type: "protocol_ready", ok: true, instance };
};

export const startPlotSupervisorIpcServer = async (input: {
	readonly options: PlotSupervisorOptions;
	readonly supervisor?: PlotSupervisor;
}): Promise<{
	readonly supervisor: PlotSupervisor;
	readonly server: Server;
	readonly socketPath: string;
}> => {
	const socketPath = resolvePlotSupervisorSocketPath(input.options);
	await removeStaleSocketIfNeeded(socketPath);
	const supervisor = input.supervisor ?? new PlotSupervisor(input.options);
	await supervisor.recoverAfterRestart();
	const server = createServer((socket) => {
		let buffer = "";
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			void (async () => {
				for (;;) {
					const index = buffer.indexOf("\n");
					if (index === -1) return;
					const text = buffer.slice(0, index).trim();
					buffer = buffer.slice(index + 1);
					if (text === "") continue;
					const request = parseRequest(text);
					const response = await handleRequest(supervisor, request).catch(
						(error): PlotSupervisorResponse => ({
							type: "error",
							ok: false,
							error: errorMessage(error),
						}),
					);
					write(socket, response);
					if (request.type !== "protocol_stream" || response.type === "error")
						continue;
					const stream = supervisor.openProtocolStream(
						request.instanceId,
						request.afterSequence ?? 0,
					);
					if (stream === undefined) {
						write(socket, unknownInstance(request.instanceId));
						continue;
					}
					socket.removeAllListeners("data");
					void (async () => {
						for await (const record of stream.records())
							write(socket, { type: "protocol_response", record });
					})().catch(() => undefined);
					let requestQueue = Promise.resolve();
					socket.on("data", (streamChunk: Buffer | string) => {
						buffer += streamChunk.toString();
						for (;;) {
							const streamIndex = buffer.indexOf("\n");
							if (streamIndex === -1) break;
							const streamText = buffer.slice(0, streamIndex).trim();
							buffer = buffer.slice(streamIndex + 1);
							if (streamText === "") continue;
							requestQueue = requestQueue
								.then(async () => {
									const record = decodePlotClientRecord(
										JSON.parse(streamText) as unknown,
									);
									write(socket, {
										type: "protocol_response",
										record: await stream.submit(record),
									});
									return undefined;
								})
								.catch((error) => {
									write(socket, {
										type: "error",
										ok: false,
										error: errorMessage(error),
									});
								});
						}
					});
					socket.once("close", stream.close);
					return;
				}
			})().catch((error) =>
				write(socket, { type: "error", ok: false, error: errorMessage(error) }),
			);
		});
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return { supervisor, server, socketPath };
};

const removeStaleSocketIfNeeded = async (socketPath: string): Promise<void> => {
	if (!existsSync(socketPath)) return;
	if (await isSocketLive(socketPath))
		throw new Error(`Plot supervisor is already running: ${socketPath}`);
	unlinkSync(socketPath);
};

const isSocketLive = async (socketPath: string): Promise<boolean> =>
	new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		let settled = false;
		const finish = (result: boolean) => {
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};
		socket.on("connect", () => finish(true));
		socket.on("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ECONNREFUSED" || error.code === "ENOENT") {
				finish(false);
				return;
			}
			if (error.code === "EPIPE" || error.code === "ECONNRESET") {
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

export const sendPlotSupervisorIpcRequest = async (
	options: PlotSupervisorOptions,
	request: PlotSupervisorRequest,
): Promise<PlotSupervisorResponse> =>
	new Promise((resolve, reject) => {
		const socket = createConnection(resolvePlotSupervisorSocketPath(options));
		let buffer = "";
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			socket.removeAllListeners();
			fn();
		};
		socket.on("connect", () => socket.write(line(request)));
		socket.on("error", (error) => finish(() => reject(error)));
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			const index = buffer.indexOf("\n");
			if (index === -1) return;
			try {
				const response = JSON.parse(
					buffer.slice(0, index),
				) as PlotSupervisorResponse;
				finish(() => {
					resolve(response);
					socket.end();
				});
			} catch (error) {
				finish(() => {
					reject(error);
					socket.destroy();
				});
			}
		});
	});
