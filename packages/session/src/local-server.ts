import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { AsyncQueue } from "@plot/common/async-queue";
import {
	decodePlotClientRecord,
	makePlotErrorResponse,
	plotProtocolRequestId,
	type PlotServerRecord,
} from "./protocol.js";
import {
	makePlotProtocolLayer,
	type PlotProtocolLayerOptions,
} from "./protocol-handler.js";
import {
	makeControlSessionRegistry,
	makeControlSessionRuntime,
	type ControlSessionRegistry,
	type ControlSessionRuntime,
} from "./control-server.js";
import { createPlotSessionHost } from "./session-host.js";
import {
	ensureLocalControlToken,
	localControlTokenMatches,
	tokenFromRequest,
	type LocalControlToken,
} from "./local-server-auth.js";
import {
	defaultLocalPlotServerPort,
	discoverHealthyLocalPlotServer,
	healthCheckLocalPlotServer,
	writeLocalPlotServerMetadata,
	type LocalPlotServerMetadata,
} from "./local-server-metadata.js";
import {
	resolveLocalPlotServerPaths,
	type LocalPlotServerPathOptions,
	type LocalPlotServerPaths,
} from "./local-server-paths.js";
import {
	applyStoppedOneshotRetention,
	catalogEntryFromSummary,
	refreshPlotSessionCatalogFromHistory,
	upsertPlotSessionCatalogEntry,
} from "./session-catalog.js";
import type { OpenSessionParams, PlotProtocolLimits } from "./protocol.js";

interface WebSocketData {
	readonly protocol: ReturnType<typeof makePlotProtocolLayer>;
	readonly output: AsyncQueue<PlotServerRecord>;
	readonly heartbeat: ReturnType<typeof setInterval>;
	lastSeenAt: number;
}

export interface LocalPlotServerOptions extends LocalPlotServerPathOptions {
	readonly hostname?: string;
	readonly port?: number;
	readonly cwd?: string;
	readonly stablePort?: number;
	readonly registry?: ControlSessionRegistry;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession"
	>;
	readonly print?: (line: string) => Promise<void> | void;
}

export interface LocalPlotServerHandle {
	readonly url: string;
	readonly metadata: LocalPlotServerMetadata;
	readonly token: LocalControlToken;
	readonly paths: LocalPlotServerPaths;
	readonly registry: ControlSessionRegistry;
	readonly server?: Bun.Server<WebSocketData>;
	readonly alreadyRunning: boolean;
	readonly stop: () => Promise<void>;
}

const nowIso = () => new Date().toISOString();

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const isAddressInUse = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	"code" in error &&
	(error as { readonly code?: unknown }).code === "EADDRINUSE";

const normalizeHostname = (hostname: string | undefined): string =>
	hostname ?? "localhost";

const listenUrl = (hostname: string, port: number): string =>
	`http://${hostname}:${port}`;

const websocketUrl = (url: string): string =>
	url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const printListening = async (
	print: ((line: string) => Promise<void> | void) | undefined,
	url: string,
	alreadyRunning: boolean,
) => {
	await print?.(
		JSON.stringify({
			event: "plot_server_listening",
			url,
			wsUrl: `${websocketUrl(url)}/ws`,
			alreadyRunning,
		}),
	);
};

const allowedOrigin = (origin: string | null): boolean => {
	if (!origin) return true;
	try {
		const parsed = new URL(origin);
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
	} catch {
		return false;
	}
};

const unauthorized = () => new Response("unauthorized\n", { status: 401 });

const closeWithError = (
	ws: Bun.ServerWebSocket<WebSocketData>,
	code: string,
	message: string,
) => {
	ws.send(
		JSON.stringify(
			makePlotErrorResponse({
				id: plotProtocolRequestId(`server-${code}`),
				code: code === "cursor_expired" ? "cursor_expired" : "internal_error",
				message,
			}),
		),
	);
	ws.close(1011, message.slice(0, 120));
};

const updateCatalogForRuntime = async (
	paths: LocalPlotServerPaths,
	runtime: ControlSessionRuntime,
) => {
	const historyPath = runtime.history?.historyPath;
	if (!historyPath) return;
	const summary = await runtime.summary();
	await upsertPlotSessionCatalogEntry(
		paths,
		catalogEntryFromSummary({ summary, historyPath }),
	);
	await applyStoppedOneshotRetention({ paths });
};

const makeOpenSession =
	(input: {
		readonly paths: LocalPlotServerPaths;
		readonly cwd: string;
		readonly registry: ControlSessionRegistry;
	}) =>
	async (params: OpenSessionParams): Promise<ControlSessionRuntime> => {
		const sessionId = params.sessionId ?? `session-${randomUUID()}`;
		const host = await createPlotSessionHost({
			sessionId,
			cwd: params.cwd ?? input.cwd,
			...(params.workflowPath === undefined
				? {}
				: { workflowPath: params.workflowPath }),
		});
		const runtime = makeControlSessionRuntime({
			session: host.session,
			history: host.sessionHistory,
			cwd: host.paths.cwd,
			...(host.workflow.path === undefined
				? {}
				: { workflowPath: host.workflow.path }),
			onChanged: async () => {
				await input.registry.publishChanged(sessionId);
				await updateCatalogForRuntime(input.paths, runtime);
			},
		});
		await updateCatalogForRuntime(input.paths, runtime);
		return runtime;
	};

const makeFetchHandler = (input: {
	readonly startedAt: string;
	readonly token: LocalControlToken;
	readonly registry: ControlSessionRegistry;
	readonly paths: LocalPlotServerPaths;
	readonly cwd: string;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession"
	>;
}) => {
	const openSession = makeOpenSession({
		paths: input.paths,
		cwd: input.cwd,
		registry: input.registry,
	});
	return (request: Request, server: Bun.Server<WebSocketData>): Response => {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			if (
				!localControlTokenMatches(input.token.token, tokenFromRequest(request))
			)
				return unauthorized();
			return Response.json({
				ok: true,
				name: "plot-local-server",
				pid: process.pid,
				startedAt: input.startedAt,
				tokenFingerprint: input.token.fingerprint,
			});
		}
		if (url.pathname !== "/ws")
			return new Response("not found\n", { status: 404 });
		if (!allowedOrigin(request.headers.get("origin")))
			return new Response("forbidden origin\n", { status: 403 });
		if (!localControlTokenMatches(input.token.token, tokenFromRequest(request)))
			return unauthorized();
		const protocol = makePlotProtocolLayer({
			...input.protocolOptions,
			capabilities: [
				"stdio_jsonl",
				"session_history_replay",
				...(input.protocolOptions?.capabilities ?? []),
				"websocket",
				"local_plot_server",
			],
			registry: input.registry,
			openSession,
			connectionId: `ws-${randomUUID()}`,
		});
		const output = new AsyncQueue<PlotServerRecord>({
			capacity:
				(input.protocolOptions?.limits as PlotProtocolLimits | undefined)
					?.maxPendingRequests ?? 64,
		});
		const heartbeat = setInterval(() => undefined, 30_000);
		const upgraded = server.upgrade(request, {
			data: { protocol, output, heartbeat, lastSeenAt: Date.now() },
		});
		return upgraded
			? new Response(null)
			: new Response("websocket upgrade failed\n", { status: 400 });
	};
};

const websocketHandlers = {
	async open(ws: Bun.ServerWebSocket<WebSocketData>) {
		const send = async (record: PlotServerRecord) => {
			if (ws.readyState !== WebSocket.OPEN) return;
			if (ws.getBufferedAmount() > 8 * 1024 * 1024) {
				closeWithError(
					ws,
					"cursor_expired",
					"client fell behind; reconnect and resync",
				);
				return;
			}
			ws.send(JSON.stringify(record));
		};
		ws.data.lastSeenAt = Date.now();
		clearInterval(ws.data.heartbeat);
		const heartbeat = setInterval(() => {
			if (Date.now() - ws.data.lastSeenAt > 45_000) {
				ws.close(1001, "heartbeat timeout");
				return;
			}
			ws.ping();
		}, 15_000);
		Object.assign(ws.data, { heartbeat });
		ws.data.output.offer(await ws.data.protocol.welcome(), { force: true });
		void (async () => {
			for await (const record of ws.data.protocol.output()) {
				if (ws.data.output.offer(record)) continue;
				closeWithError(
					ws,
					"cursor_expired",
					"client output queue filled; reconnect and resync",
				);
				break;
			}
		})();
		void (async () => {
			for await (const record of ws.data.output) await send(record);
		})();
	},
	async message(
		ws: Bun.ServerWebSocket<WebSocketData>,
		message: string | Buffer,
	) {
		ws.data.lastSeenAt = Date.now();
		try {
			const text =
				typeof message === "string" ? message : message.toString("utf8");
			await ws.data.protocol.submit(
				await decodePlotClientRecord(JSON.parse(text) as unknown),
			);
		} catch (error) {
			ws.send(
				JSON.stringify(
					makePlotErrorResponse({
						code: "invalid_request",
						message: errorMessage(error),
					}),
				),
			);
		}
	},
	pong(ws: Bun.ServerWebSocket<WebSocketData>) {
		ws.data.lastSeenAt = Date.now();
	},
	close(ws: Bun.ServerWebSocket<WebSocketData>) {
		clearInterval(ws.data.heartbeat);
		ws.data.output.close();
	},
};

const bindServer = (input: {
	readonly hostname: string;
	readonly port: number;
	readonly startedAt: string;
	readonly token: LocalControlToken;
	readonly registry: ControlSessionRegistry;
	readonly paths: LocalPlotServerPaths;
	readonly cwd: string;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession"
	>;
}): Bun.Server<WebSocketData> =>
	Bun.serve<WebSocketData>({
		hostname: input.hostname,
		port: input.port,
		fetch: makeFetchHandler(input),
		websocket: websocketHandlers,
	});

export const startLocalPlotServer = async (
	options: LocalPlotServerOptions = {},
): Promise<LocalPlotServerHandle> => {
	const paths = resolveLocalPlotServerPaths(options);
	await mkdir(paths.logsDir, { recursive: true });
	const token = await ensureLocalControlToken(paths);
	const registry = options.registry ?? makeControlSessionRegistry();
	await refreshPlotSessionCatalogFromHistory(paths);
	const discovered = await discoverHealthyLocalPlotServer({
		paths,
		token: token.token,
		tokenFingerprint: token.fingerprint,
	});
	const hostname = normalizeHostname(options.hostname);
	const requestedPort = options.port;
	if (discovered && requestedPort === undefined) {
		await printListening(options.print, discovered.url, true);
		return {
			url: discovered.url,
			metadata: discovered,
			token,
			paths,
			registry,
			alreadyRunning: true,
			stop: async () => undefined,
		};
	}
	const startedAt = nowIso();
	const startOnPort = (port: number) =>
		bindServer({
			hostname,
			port,
			startedAt,
			token,
			registry,
			paths,
			cwd: options.cwd ?? process.cwd(),
			...(options.protocolOptions === undefined
				? {}
				: { protocolOptions: options.protocolOptions }),
		});
	const stablePort = options.stablePort ?? defaultLocalPlotServerPort;
	const firstPort = requestedPort ?? stablePort;
	let server: Bun.Server<WebSocketData>;
	try {
		server = startOnPort(firstPort);
	} catch (error) {
		if (!isAddressInUse(error)) throw error;
		const occupiedUrl = listenUrl(hostname, firstPort);
		const healthy = await healthCheckLocalPlotServer({
			url: occupiedUrl,
			token: token.token,
			expectedTokenFingerprint: token.fingerprint,
		});
		if (healthy) {
			await printListening(options.print, occupiedUrl, true);
			return {
				url: occupiedUrl,
				metadata: {
					url: occupiedUrl,
					pid: healthy.pid,
					startedAt: healthy.startedAt,
					tokenFingerprint: healthy.tokenFingerprint,
				},
				token,
				paths,
				registry,
				alreadyRunning: true,
				stop: async () => undefined,
			};
		}
		if (requestedPort !== undefined && requestedPort !== stablePort)
			throw error;
		server = startOnPort(0);
	}
	const boundPort = server.port;
	if (boundPort === undefined)
		throw new Error("local Plot server did not bind a TCP port");
	const url = listenUrl(hostname, boundPort);
	const metadata = {
		url,
		pid: process.pid,
		startedAt,
		tokenFingerprint: token.fingerprint,
	};
	await writeLocalPlotServerMetadata(paths, metadata);
	await printListening(options.print, url, false);
	return {
		url,
		metadata,
		token,
		paths,
		registry,
		server,
		alreadyRunning: false,
		stop: async () => {
			server.stop(true);
		},
	};
};

export const runLocalPlotServer = async (
	options: LocalPlotServerOptions = {},
): Promise<void> => {
	const handle = await startLocalPlotServer(options);
	if (handle.alreadyRunning) return;
	await new Promise<void>(() => undefined);
};
