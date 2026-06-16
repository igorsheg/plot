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
	localPlotServerVersion,
	readLocalPlotServerMetadata,
	removeLocalPlotServerMetadataIfMatches,
	sameLocalPlotServerRegistration,
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
	readPlotSessionCatalog,
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

export interface LocalPlotServerOptions extends LocalPlotServerPathOptions {
	readonly hostname?: string;
	readonly port?: number;
	readonly cwd?: string;
	readonly stablePort?: number;
	readonly registry?: ControlSessionRegistry;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession" | "listArchivedSessions" | "shutdownServer"
	>;
	/**
	 * Reuse a healthy server found in user-level metadata. Product clients use
	 * reuse; explicit `plot serve` foreground starts do not, so Ctrl-C owns the
	 * process they started.
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
	readonly registrationLost: Promise<void>;
	readonly shutdownRequested: Promise<void>;
	readonly stop: (options?: { readonly unregister?: boolean }) => Promise<void>;
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

const archivedSessionSummaries = async (paths: LocalPlotServerPaths) =>
	(await readPlotSessionCatalog(paths)).entries
		.filter((entry) => entry.stale !== true)
		.map((entry) => entry.summary);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const countField = (
	result: Record<string, unknown>,
	arrayKey: string,
	countKey: string,
) => {
	const value = result[arrayKey];
	if (Array.isArray(value)) return value.length;
	const count = result[countKey];
	return typeof count === "number" ? count : 0;
};

const oneshotTickIsTerminal = (event: SessionHistoryEvent): boolean => {
	if (event.type !== "tick_completed" || !isRecord(event.payload)) return false;
	const result = event.payload["result"];
	if (!isRecord(result)) return false;
	const snapshot = result["snapshot"];
	const running = isRecord(snapshot) ? snapshot["running"] : undefined;
	const runningSize = running instanceof Map ? running.size : 0;
	const started = countField(result, "started", "startedCount");
	const selected = countField(result, "selected", "selectedCount");
	const completions = countField(result, "completions", "completionCount");
	return (
		runningSize === 0 && started === 0 && selected === 0 && completions > 0
	);
};

const startOneshotTerminalMonitor = (
	runtime: ControlSessionRuntime,
	registry: ControlSessionRegistry,
) => {
	void (async () => {
		for await (const event of runtime.events()) {
			if (!oneshotTickIsTerminal(event)) continue;
			await runtime.close();
			await registry.unregister(runtime.sessionId);
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
			startOneshotTerminalMonitor(runtime, input.registry);
		await updateCatalogForRuntime(input.paths, runtime);
		return runtime;
	};

const makeFetchHandler = (input: {
	readonly startedAt: string;
	readonly metadata: LocalPlotServerMetadata;
	readonly token: LocalControlToken;
	readonly registry: ControlSessionRegistry;
	readonly paths: LocalPlotServerPaths;
	readonly cwd: string;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession" | "listArchivedSessions" | "shutdownServer"
	>;
	readonly shutdownServer: () => Promise<void> | void;
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
				id: input.metadata.id,
				version: input.metadata.version,
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
			listArchivedSessions: () => archivedSessionSummaries(input.paths),
			shutdownServer: input.shutdownServer,
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
		void ws.data.protocol.close().catch(() => undefined);
	},
};

const bindServer = (input: {
	readonly hostname: string;
	readonly port: number;
	readonly startedAt: string;
	readonly metadata: LocalPlotServerMetadata;
	readonly token: LocalControlToken;
	readonly registry: ControlSessionRegistry;
	readonly paths: LocalPlotServerPaths;
	readonly cwd: string;
	readonly protocolOptions?: Omit<
		PlotProtocolLayerOptions,
		"registry" | "openSession" | "listArchivedSessions" | "shutdownServer"
	>;
	readonly shutdownServer: () => Promise<void> | void;
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
			registrationLost: new Promise<void>(() => undefined),
			shutdownRequested: new Promise<void>(() => undefined),
			stop: async () => undefined,
		};
	}
	const startedAt = nowIso();
	const registrationId = randomUUID();
	const metadataFor = (url: string): LocalPlotServerMetadata => ({
		id: registrationId,
		version: localPlotServerVersion,
		url,
		pid: process.pid,
		startedAt,
		tokenFingerprint: token.fingerprint,
	});
	let resolveShutdownRequested!: () => void;
	const shutdownRequested = new Promise<void>((resolve) => {
		resolveShutdownRequested = resolve;
	});
	const startOnPort = (port: number) =>
		bindServer({
			hostname,
			port,
			startedAt,
			metadata: metadataFor(listenUrl(hostname, port)),
			token,
			registry,
			paths,
			cwd: options.cwd ?? process.cwd(),
			...(options.protocolOptions === undefined
				? {}
				: { protocolOptions: options.protocolOptions }),
			shutdownServer: resolveShutdownRequested,
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
					id: healthy.id,
					version: healthy.version,
					url: occupiedUrl,
					pid: healthy.pid,
					startedAt: healthy.startedAt,
					tokenFingerprint: healthy.tokenFingerprint,
				},
				token,
				paths,
				registry,
				alreadyRunning: true,
				registrationLost: new Promise<void>(() => undefined),
				shutdownRequested: new Promise<void>(() => undefined),
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
	const metadata = metadataFor(url);
	await writeLocalPlotServerMetadata(paths, metadata);
	let resolveRegistrationLost!: () => void;
	const registrationLost = new Promise<void>((resolve) => {
		resolveRegistrationLost = resolve;
	});
	let stopped = false;
	const guard = setInterval(() => {
		void (async () => {
			if (stopped) return;
			const current = await readLocalPlotServerMetadata(paths);
			if (
				current !== undefined &&
				sameLocalPlotServerRegistration(current, metadata)
			)
				return;
			resolveRegistrationLost();
		})().catch(() => resolveRegistrationLost());
	}, 10_000);
	guard.unref?.();
	await printListening(options.print, url, false);
	return {
		url,
		metadata,
		token,
		paths,
		registry,
		server,
		alreadyRunning: false,
		registrationLost,
		shutdownRequested,
		stop: async (stopOptions = {}) => {
			if (stopped) return;
			stopped = true;
			clearInterval(guard);
			if (stopOptions.unregister !== false)
				await removeLocalPlotServerMetadataIfMatches(paths, metadata).catch(
					() => undefined,
				);
			await Promise.all(
				registry
					.list()
					.map((runtime) => runtime.close().catch(() => undefined)),
			);
			server.stop(true);
		},
	};
};

/**
 * Resolve on the first SIGINT/SIGTERM. Lets a foreground server hold the
 * terminal and then run its cleanup before exiting, instead of being
 * hard-killed mid-flight.
 */
export const awaitShutdownSignal = (): Promise<void> =>
	new Promise((resolve) => {
		const onSignal = () => {
			process.off("SIGINT", onSignal);
			process.off("SIGTERM", onSignal);
			resolve();
		};
		process.once("SIGINT", onSignal);
		process.once("SIGTERM", onSignal);
	});

export const runLocalPlotServer = async (
	options: LocalPlotServerOptions = {},
): Promise<void> => {
	const handle = await startLocalPlotServer(options);
	if (handle.alreadyRunning) return;
	const reason = await Promise.race([
		awaitShutdownSignal().then(() => "signal" as const),
		handle.registrationLost.then(() => "registration_lost" as const),
		handle.shutdownRequested.then(() => "shutdown_requested" as const),
	]);
	await handle.stop({ unregister: reason !== "registration_lost" });
};
