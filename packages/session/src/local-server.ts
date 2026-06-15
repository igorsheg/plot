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
import type { PlotAgentSessionCliOverrides } from "./pi-agent-session.js";
import type { OpenSessionParams, PlotProtocolLimits } from "./protocol.js";
import type { SessionHistoryEvent } from "@plot/control/session-history";

interface WebSocketData {
	readonly protocol: ReturnType<typeof makePlotProtocolLayer>;
	readonly output: AsyncQueue<PlotServerRecord>;
	readonly heartbeat: ReturnType<typeof setInterval>;
	lastSeenAt: number;
}

export interface LocalPlotWebAsset {
	readonly path: string;
	readonly contentType: string;
	readonly body: string | Uint8Array;
}

export interface LocalPlotWebAssets {
	readonly indexHtml: string;
	readonly assets: readonly LocalPlotWebAsset[];
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
	readonly webAssets?: LocalPlotWebAssets;
	/**
	 * Reuse a healthy server found in user-level metadata. Product client
	 * autostart uses reuse; explicit `plot serve` / `plot web` foreground
	 * commands do not, so Ctrl-C owns the process they started.
	 */
	readonly reuseExisting?: boolean;
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

const normalizeAssetPath = (path: string): string =>
	path.startsWith("/") ? path : `/${path}`;

const isAssetRequest = (path: string): boolean =>
	path.startsWith("/assets/") || path === "/favicon.ico";

const cacheHeadersFor = (asset: LocalPlotWebAsset): HeadersInit => ({
	"content-type": asset.contentType,
	"cache-control": "public, max-age=31536000, immutable",
});

const arrayBufferFrom = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const bodyForAsset = (asset: LocalPlotWebAsset): BodyInit =>
	typeof asset.body === "string"
		? asset.body
		: new Blob([arrayBufferFrom(asset.body)]);

const indexHeaders: HeadersInit = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const oneshotTickIsTerminal = (event: SessionHistoryEvent): boolean => {
	if (event.type !== "tick_completed" || !isRecord(event.payload)) return false;
	const result = event.payload["result"];
	if (!isRecord(result)) return false;
	const snapshot = result["snapshot"];
	const running = isRecord(snapshot) ? snapshot["running"] : undefined;
	const runningSize = running instanceof Map ? running.size : 0;
	const started = Array.isArray(result["started"])
		? result["started"].length
		: 0;
	const selected = Array.isArray(result["selected"])
		? result["selected"].length
		: 0;
	const completions = Array.isArray(result["completions"])
		? result["completions"].length
		: 0;
	return (
		runningSize === 0 && started === 0 && selected === 0 && completions > 0
	);
};

const startOneshotTerminalMonitor = (runtime: ControlSessionRuntime) => {
	void (async () => {
		for await (const event of runtime.events()) {
			if (!oneshotTickIsTerminal(event)) continue;
			await runtime.close();
			break;
		}
	})().catch(() => undefined);
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
			...(params.plotDir === undefined ? {} : { plotDir: params.plotDir }),
			...(params.agentDir === undefined ? {} : { agentDir: params.agentDir }),
			...(params.sessionDir === undefined
				? {}
				: { sessionDir: params.sessionDir }),
			...(params.requestQueueCapacity === undefined
				? {}
				: { requestQueueCapacity: params.requestQueueCapacity }),
			...(params.eventCapacity === undefined
				? {}
				: { eventCapacity: params.eventCapacity }),
			...(params.replayCapacity === undefined
				? {}
				: { replayCapacity: params.replayCapacity }),
			...(params.tickIntervalMs === undefined
				? {}
				: { tickIntervalMs: params.tickIntervalMs }),
			...(params.maxRunDurationMs === undefined
				? {}
				: { maxRunDurationMs: params.maxRunDurationMs }),
			...(params.agentSessionOverrides === undefined
				? {}
				: {
						agentSessionOverrides:
							params.agentSessionOverrides as PlotAgentSessionCliOverrides,
					}),
		});
		const runtime = makeControlSessionRuntime({
			session: host.session,
			history: host.sessionHistory,
			cwd: host.paths.cwd,
			mode: params.mode ?? "watch",
			...(host.workflow.path === undefined
				? {}
				: { workflowPath: host.workflow.path }),
			onChanged: async () => {
				await input.registry.publishChanged(sessionId);
				await updateCatalogForRuntime(input.paths, runtime);
			},
		});
		if ((params.mode ?? "watch") === "oneshot")
			startOneshotTerminalMonitor(runtime);
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
	readonly webAssets?: LocalPlotWebAssets;
}) => {
	const openSession = makeOpenSession({
		paths: input.paths,
		cwd: input.cwd,
		registry: input.registry,
	});
	const webAssetMap = new Map(
		(input.webAssets?.assets ?? []).map((asset) => [
			normalizeAssetPath(asset.path),
			asset,
		]),
	);
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
		if (url.pathname !== "/ws") {
			const asset = webAssetMap.get(url.pathname);
			if (asset !== undefined)
				return new Response(bodyForAsset(asset), {
					headers: cacheHeadersFor(asset),
				});
			if (input.webAssets !== undefined && !isAssetRequest(url.pathname))
				return new Response(input.webAssets.indexHtml, {
					headers: indexHeaders,
				});
			return new Response("not found\n", { status: 404 });
		}
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
	readonly webAssets?: LocalPlotWebAssets;
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
	const reuseExisting = options.reuseExisting ?? true;
	await refreshPlotSessionCatalogFromHistory(paths);
	const discovered = reuseExisting
		? await discoverHealthyLocalPlotServer({
				paths,
				token: token.token,
				tokenFingerprint: token.fingerprint,
			})
		: undefined;
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
			...(options.webAssets === undefined
				? {}
				: { webAssets: options.webAssets }),
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
			if (!reuseExisting)
				throw new Error(
					`Local Plot Server is already running at ${occupiedUrl}; stop it before starting a foreground server on this port.`,
					{ cause: error },
				);
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
		if (requestedPort !== undefined) throw error;
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
