import { existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createConnection, createServer, type Server } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import {
	Fleet,
	createFileFleetStore,
	decodeFleetRequest,
	decodeFleetResponse,
	type FleetRequest,
	type FleetResponse,
} from "./fleet.js";
import { stringifyJsonl } from "./jsonl.js";
import { errorMessage } from "./primitives.js";

export interface FleetIpcOptions {
	readonly cwd: string;
	readonly fleetDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
}

const resolveFleetIpcDir = (options: FleetIpcOptions): string =>
	resolvePath(options.fleetDir ?? join(homedir(), ".plot", "fleet"));

export const resolveFleetIpcSocketPath = (options: FleetIpcOptions): string =>
	join(resolveFleetIpcDir(options), "fleet.sock");

const write = (socket: { write: (text: string) => void }, response: unknown) =>
	socket.write(stringifyJsonl(response, { maxLineBytes: 2 * 1024 * 1024 }));

const makeFleet = (options: FleetIpcOptions): Fleet => {
	const fleetDir = resolveFleetIpcDir(options);
	return new Fleet({
		cwd: options.cwd,
		store: createFileFleetStore(join(fleetDir, "instances.json")),
		...(options.cli === undefined ? {} : { cli: options.cli }),
	});
};

const handleRequest = async (fleet: Fleet, request: FleetRequest) => {
	if (request.type === "list")
		return { type: "list_result", ok: true, instances: await fleet.list() };
	if (request.type === "spawn")
		return {
			type: "spawn_result",
			ok: true,
			instance: await fleet.spawn(request.options),
		};
	if (request.type === "status")
		return {
			type: "status_result",
			ok: true,
			instance: await fleet.status(request.id),
		};
	if (request.type === "stop")
		return {
			type: "stop_result",
			ok: true,
			id: request.id,
			instance: await fleet.stop(request.id),
		};
	return {
		type: "protocol_ready",
		ok: true,
		instance: await fleet.status(request.id),
	};
};

export const startFleetIpcServer = async (input: {
	readonly options: FleetIpcOptions;
	readonly fleet?: Fleet;
}): Promise<{
	readonly fleet: Fleet;
	readonly server: Server;
	readonly socketPath: string;
}> => {
	const socketPath = resolveFleetIpcSocketPath(input.options);
	await mkdir(dirname(socketPath), { recursive: true });
	if (existsSync(socketPath)) unlinkSync(socketPath);
	const fleet = input.fleet ?? makeFleet(input.options);
	await fleet.recoverAfterRestart();
	const server = createServer((socket) => {
		let buffer = "";
		const streamRecords = async (
			request: Extract<FleetRequest, { type: "protocol_stream" }>,
		) => {
			write(socket, await handleRequest(fleet, request));
			const records = fleet.attachRecords(request.id, request.afterSequence);
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
					const request = decodeFleetRequest(JSON.parse(line) as unknown);
					if (request.type === "protocol_stream") {
						// eslint-disable-next-line no-await-in-loop -- stream requests take over this socket.
						await streamRecords(request);
						return;
					}
					// eslint-disable-next-line no-await-in-loop -- socket requests are handled in wire order.
					write(socket, await handleRequest(fleet, request));
				}
			})().catch((error) =>
				write(socket, { type: "error", ok: false, error: errorMessage(error) }),
			);
		});
	});
	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolveListen();
		});
	});
	return { fleet, server, socketPath };
};

export const sendFleetIpcRequest = async (
	options: FleetIpcOptions,
	request: FleetRequest,
): Promise<FleetResponse> =>
	new Promise((resolve, reject) => {
		const socket = createConnection(resolveFleetIpcSocketPath(options));
		let buffer = "";
		socket.on("connect", () => write(socket, request));
		socket.on("error", reject);
		socket.on("data", (chunk: Buffer | string) => {
			buffer += chunk.toString();
			const index = buffer.indexOf("\n");
			if (index === -1) return;
			resolve(
				decodeFleetResponse(JSON.parse(buffer.slice(0, index)) as unknown),
			);
			socket.end();
		});
	});
