import { randomUUID } from "node:crypto";
import type { PlotWebAsset, PlotWebAssets } from "./web-assets.js";

export interface StartPlotWebGatewayOptions {
	readonly assets: PlotWebAssets;
	readonly daemonWsUrl: string;
	readonly hostname?: string;
	readonly port?: number;
}

export interface PlotWebGatewayHandle {
	readonly url: string;
	readonly wsUrl: string;
	readonly stop: () => Promise<void>;
}

interface WebGatewaySocketData {
	readonly gatewayToken: string;
	readonly daemonWsUrl: string;
	readonly queued: (string | Buffer)[];
	upstream?: WebSocket;
	closed?: boolean;
}

const normalizeHostname = (hostname: string | undefined): string =>
	hostname ?? "localhost";

const listenUrl = (hostname: string, port: number): string =>
	`http://${hostname}:${port}`;

const websocketUrl = (url: string): string =>
	url.replace(/^http:/, "ws:").replace(/^https:/, "wss:");

const normalizeAssetPath = (path: string): string =>
	path.startsWith("/") ? path : `/${path}`;

const isAssetRequest = (path: string): boolean =>
	path.startsWith("/assets/") || path === "/favicon.ico";

const cacheHeadersFor = (asset: PlotWebAsset): HeadersInit => ({
	"content-type": asset.contentType,
	"cache-control": "public, max-age=31536000, immutable",
});

const indexHeaders: HeadersInit = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
};

const arrayBufferFrom = (bytes: Uint8Array): ArrayBuffer => {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
};

const bodyForAsset = (asset: PlotWebAsset): BodyInit =>
	typeof asset.body === "string"
		? asset.body
		: new Blob([arrayBufferFrom(asset.body)]);

const allowedOrigin = (origin: string | null): boolean => {
	if (!origin) return true;
	try {
		const parsed = new URL(origin);
		return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
	} catch {
		return false;
	}
};

const tokenFromRequest = (request: Request): string | undefined => {
	const url = new URL(request.url);
	return (
		url.searchParams.get("token") ??
		request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
		undefined
	);
};

const flushQueued = (ws: Bun.ServerWebSocket<WebGatewaySocketData>) => {
	const upstream = ws.data.upstream;
	if (upstream?.readyState !== WebSocket.OPEN) return;
	for (const message of ws.data.queued.splice(0)) upstream.send(message);
};

const textFromWebSocketData = async (data: unknown): Promise<string> => {
	if (typeof data === "string") return data;
	if (data instanceof Blob) return data.text();
	if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
	if (ArrayBuffer.isView(data))
		return new TextDecoder().decode(
			new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		);
	return String(data);
};

const webSocketHandlers = {
	open(ws: Bun.ServerWebSocket<WebGatewaySocketData>) {
		const upstream = new WebSocket(ws.data.daemonWsUrl);
		ws.data.upstream = upstream;
		upstream.addEventListener("open", () => flushQueued(ws));
		upstream.addEventListener("message", (event) => {
			void textFromWebSocketData(event.data)
				.then((text) => {
					if (ws.readyState === WebSocket.OPEN) ws.send(text);
					return undefined;
				})
				.catch(() => ws.close(1011, "invalid daemon websocket message"));
		});
		upstream.addEventListener("close", () => {
			if (!ws.data.closed) ws.close(1001, "daemon websocket closed");
		});
		upstream.addEventListener("error", () => {
			if (!ws.data.closed) ws.close(1011, "daemon websocket failed");
		});
	},
	message(
		ws: Bun.ServerWebSocket<WebGatewaySocketData>,
		message: string | Buffer,
	) {
		const upstream = ws.data.upstream;
		if (upstream?.readyState === WebSocket.OPEN) {
			upstream.send(message);
			return;
		}
		if (ws.data.queued.length >= 64) {
			ws.close(1011, "gateway websocket queue full");
			return;
		}
		ws.data.queued.push(message);
	},
	close(ws: Bun.ServerWebSocket<WebGatewaySocketData>) {
		ws.data.closed = true;
		ws.data.queued.length = 0;
		ws.data.upstream?.close();
	},
};

export const startPlotWebGateway = (
	options: StartPlotWebGatewayOptions,
): PlotWebGatewayHandle => {
	const hostname = normalizeHostname(options.hostname);
	const gatewayToken = randomUUID();
	const assets = new Map(
		options.assets.assets.map((asset) => [
			normalizeAssetPath(asset.path),
			asset,
		]),
	);
	const server = Bun.serve<WebGatewaySocketData>({
		hostname,
		port: options.port ?? 0,
		fetch: (request, bunServer) => {
			const url = new URL(request.url);
			if (url.pathname === "/ws") {
				if (!allowedOrigin(request.headers.get("origin")))
					return new Response("forbidden origin\n", { status: 403 });
				if (tokenFromRequest(request) !== gatewayToken)
					return new Response("unauthorized\n", { status: 401 });
				const upgraded = bunServer.upgrade(request, {
					data: {
						gatewayToken,
						daemonWsUrl: options.daemonWsUrl,
						queued: [],
					},
				});
				return upgraded
					? new Response(null)
					: new Response("websocket upgrade failed\n", { status: 400 });
			}
			const asset = assets.get(url.pathname);
			if (asset !== undefined)
				return new Response(bodyForAsset(asset), {
					headers: cacheHeadersFor(asset),
				});
			if (!isAssetRequest(url.pathname))
				return new Response(options.assets.indexHtml, {
					headers: indexHeaders,
				});
			return new Response("not found\n", { status: 404 });
		},
		websocket: webSocketHandlers,
	});
	const port = server.port;
	if (port === undefined)
		throw new Error("web gateway did not bind a TCP port");
	const url = listenUrl(hostname, port);
	const ws = new URL("/ws", url);
	ws.protocol = websocketUrl(url).startsWith("wss:") ? "wss:" : "ws:";
	ws.searchParams.set("token", gatewayToken);
	return {
		url,
		wsUrl: ws.toString(),
		stop: async () => server.stop(true),
	};
};
