import { join, extname } from "node:path";
import { existsSync } from "node:fs";

const contentTypes: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export interface WebServerHandle {
	url: string;
	stop: () => void;
}

export function startWebServer(opts: {
	port: number;
	engineUrl: string;
	webDistDir: string;
}): WebServerHandle {
	const { port, engineUrl, webDistDir } = opts;

	const server = Bun.serve({
		port,
		idleTimeout: 120,
		async fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === "/events") {
				return proxySse(engineUrl, url.pathname);
			}

			if (url.pathname === "/health") {
				return proxyJson(engineUrl, url.pathname);
			}

			return serveStatic(webDistDir, url.pathname);
		},
	});

	const resolvedUrl = `http://localhost:${server.port}`;

	return {
		url: resolvedUrl,
		stop: () => server.stop(true),
	};
}

async function proxySse(engineUrl: string, path: string): Promise<Response> {
	const upstream = await fetch(`${engineUrl}${path}`);

	if (!upstream.ok || !upstream.body) {
		return new Response(upstream.statusText, { status: upstream.status });
	}

	return new Response(upstream.body, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			"X-Accel-Buffering": "no",
			Connection: "keep-alive",
		},
	});
}

async function proxyJson(engineUrl: string, path: string): Promise<Response> {
	const upstream = await fetch(`${engineUrl}${path}`);
	return new Response(upstream.body, {
		status: upstream.status,
		headers: { "Content-Type": "application/json" },
	});
}

function serveStatic(webDistDir: string, pathname: string): Response {
	const ext = extname(pathname);

	if (ext && contentTypes[ext]) {
		const filePath = join(webDistDir, pathname);
		if (existsSync(filePath)) {
			return new Response(Bun.file(filePath), {
				headers: { "Content-Type": contentTypes[ext] },
			});
		}
		return new Response("Not Found", { status: 404 });
	}

	const indexPath = join(webDistDir, "index.html");
	if (existsSync(indexPath)) {
		return new Response(Bun.file(indexPath), {
			headers: { "Content-Type": "text/html" },
		});
	}

	return new Response("Not Found", { status: 404 });
}
