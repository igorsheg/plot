import { setTimeout as sleep } from "node:timers/promises";
import { AsyncQueue } from "@plot/common/async-queue";
import {
	decodePlotServerRecord,
	plotProtocolRequestId,
	plotProtocolVersion,
	type AttachSessionParams,
	type DetachSessionParams,
	type OpenSessionParams,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolRequestId,
	type PlotServerRecord,
	type PlotSuccessResponseRecordType,
} from "./protocol.js";
import { ensureLocalControlToken } from "./local-server-auth.js";
import {
	discoverHealthyLocalPlotServer,
	healthCheckLocalPlotServer,
	readLocalPlotServerMetadata,
	type LocalPlotServerMetadata,
} from "./local-server-metadata.js";
import { spawnLocalPlotServerDaemon } from "./local-server-daemon.js";
import {
	resolveLocalPlotServerPaths,
	type LocalPlotServerPathOptions,
	type LocalPlotServerPaths,
} from "./local-server-paths.js";

export interface LocalControlClientOptions extends LocalPlotServerPathOptions {
	readonly cwd?: string;
	readonly autostart?: boolean;
	readonly autostartTimeoutMs?: number;
}

export interface LocalControlClient {
	readonly metadata: LocalPlotServerMetadata;
	readonly paths: LocalPlotServerPaths;
	readonly welcome: Extract<PlotServerRecord, { kind: "welcome" }>;
	readonly request: (
		command: PlotCommand,
		params?: unknown,
	) => Promise<PlotSuccessResponseRecordType>;
	readonly records: () => AsyncIterable<PlotServerRecord>;
	readonly openSession: (
		params: OpenSessionParams,
	) => Promise<PlotSuccessResponseRecordType>;
	readonly attachSession: (params: AttachSessionParams) => Promise<{
		readonly response: PlotSuccessResponseRecordType;
		readonly snapshot: unknown;
		readonly lastSequence: number;
	}>;
	readonly detachSession: (
		params: DetachSessionParams,
	) => Promise<PlotSuccessResponseRecordType>;
	readonly close: () => void;
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const websocketUrl = (url: string, token: string): string => {
	const parsed = new URL("/ws", url);
	parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
	parsed.searchParams.set("token", token);
	return parsed.toString();
};

const discover = async (paths: LocalPlotServerPaths, token: string) => {
	const metadata = await readLocalPlotServerMetadata(paths);
	if (metadata !== undefined) {
		const health = await healthCheckLocalPlotServer({
			url: metadata.url,
			token,
			expectedTokenFingerprint: metadata.tokenFingerprint,
		});
		if (health) return metadata;
	}
	return discoverHealthyLocalPlotServer({
		paths,
		token,
		tokenFingerprint: (await ensureLocalControlToken(paths)).fingerprint,
	});
};

const waitForLocalPlotServer = async (input: {
	readonly paths: LocalPlotServerPaths;
	readonly token: string;
	readonly timeoutMs: number;
}): Promise<LocalPlotServerMetadata | undefined> => {
	const deadline = Date.now() + input.timeoutMs;
	while (Date.now() <= deadline) {
		const metadata = await discover(input.paths, input.token);
		if (metadata) return metadata;
		await sleep(100);
	}
	return undefined;
};

const waitForOpen = (ws: WebSocket): Promise<void> =>
	new Promise((resolve, reject) => {
		ws.addEventListener("open", () => resolve(), { once: true });
		ws.addEventListener(
			"error",
			() => reject(new Error("failed to connect to Local Plot Server")),
			{ once: true },
		);
	});

const takeWelcome = async (records: AsyncQueue<PlotServerRecord>) => {
	const record = await records.take();
	if (record.kind !== "welcome")
		throw new Error(`expected welcome record, received ${record.kind}`);
	return record;
};

export const connectLocalControlClient = async (
	options: LocalControlClientOptions = {},
): Promise<LocalControlClient> => {
	const paths = resolveLocalPlotServerPaths(options);
	const token = await ensureLocalControlToken(paths);
	let metadata = await discover(paths, token.token);
	if (metadata === undefined && options.autostart !== false) {
		spawnLocalPlotServerDaemon(options.cwd);
		metadata = await waitForLocalPlotServer({
			paths,
			token: token.token,
			timeoutMs: options.autostartTimeoutMs ?? 5_000,
		});
	}
	if (metadata === undefined)
		throw new Error("Local Plot Server is not running and autostart failed");

	const ws = new WebSocket(websocketUrl(metadata.url, token.token));
	const records = new AsyncQueue<PlotServerRecord>({ capacity: 1024 });
	const pending = new Map<
		PlotProtocolRequestId,
		{
			readonly resolve: (record: PlotSuccessResponseRecordType) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	ws.addEventListener("message", (event) => {
		void (async () => {
			try {
				const record = await decodePlotServerRecord(
					JSON.parse(String(event.data)) as unknown,
				);
				if (record.kind === "response" && record.id !== undefined) {
					const waiter = pending.get(record.id);
					if (waiter !== undefined) {
						pending.delete(record.id);
						if (record.ok) waiter.resolve(record);
						else
							waiter.reject(
								new Error(`${record.error.code}: ${record.error.message}`),
							);
					}
				}
				records.offer(record);
			} catch (error) {
				records.offer({
					protocol: plotProtocolVersion,
					kind: "response",
					ok: false,
					error: {
						code: "invalid_request",
						message: errorMessage(error),
					},
				});
			}
		})();
	});
	ws.addEventListener("close", () => {
		for (const waiter of pending.values())
			waiter.reject(new Error("Local Plot Server connection closed"));
		pending.clear();
		records.close();
	});
	await waitForOpen(ws);
	const welcome = await takeWelcome(records);
	let requestIndex = 0;
	const request = (command: PlotCommand, params?: unknown) => {
		const id = plotProtocolRequestId(`local-${++requestIndex}`);
		const record: PlotClientRecord = {
			protocol: plotProtocolVersion,
			kind: "request",
			id,
			command,
			...(params === undefined ? {} : { params }),
		};
		return new Promise<PlotSuccessResponseRecordType>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify(record));
		});
	};
	return {
		metadata,
		paths,
		welcome,
		request,
		records: () => records,
		openSession: (params) => request("open_session", params),
		attachSession: async (params) => {
			const response = await request("attach_session", params);
			const data = isRecord(response.data) ? response.data : {};
			const lastSequence =
				typeof data["lastSequence"] === "number" ? data["lastSequence"] : 0;
			return { response, snapshot: data["snapshot"], lastSequence };
		},
		detachSession: (params) => request("detach_session", params),
		close: () => ws.close(),
	};
};
