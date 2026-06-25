import { spawn } from "node:child_process";
import { readEventLogPath } from "@plot/session/event-log";
import { resolvePlotPaths } from "@plot/session/plot-paths";
import { makePlotEventRecord } from "@plot/session/protocol";
import {
	readLivePlotSessionRegistrations,
	resolvePlotSessionDiscoveryDir,
	type PlotSessionRegistration,
} from "@plot/session/session-registration";
import { webAssets, type WebAsset } from "./web-assets.generated.js";

const assets: Record<string, WebAsset> = webAssets;

export interface PlotWebGatewayOptions {
	readonly cwd: string;
	readonly agentDir?: string | undefined;
	readonly host?: string | undefined;
	readonly port?: number | undefined;
	readonly open?: boolean | undefined;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly openUrl?: (url: string) => Promise<void> | void;
}

const text = (body: unknown) =>
	new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json; charset=utf-8" },
	});

const openBrowser = (url: string) => {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	const child = spawn(command, args, { detached: true, stdio: "ignore" });
	child.on("error", (error) => {
		void error;
	});
	child.unref();
};

const assetResponse = (pathname: string): Response => {
	if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
	const path = pathname === "/" ? "/index.html" : pathname;
	const asset = assets[path];
	if (asset === undefined) return new Response("not found", { status: 404 });
	return new Response(Buffer.from(asset.bodyBase64, "base64"), {
		headers: { "content-type": asset.contentType },
	});
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sseFrame = (event: unknown, id?: number): string =>
	`${id === undefined ? "" : `id: ${id}\n`}event: plot\ndata: ${JSON.stringify(event)}\n\n`;

const parseAfterSequence = (value: string | null): number | undefined => {
	if (value === null) return 0;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const liveSessionByKey = async (input: {
	readonly discoveryDir: string;
	readonly key: string;
}): Promise<PlotSessionRegistration | undefined> =>
	(
		await readLivePlotSessionRegistrations({ discoveryDir: input.discoveryDir })
	).find((session) => session.key === input.key);

const sessionEventsResponse = (input: {
	readonly request: Request;
	readonly discoveryDir: string;
	readonly registration: PlotSessionRegistration;
	readonly after: number;
}): Response => {
	const encoder = new TextEncoder();
	let cancelled = false;
	const cancel = () => {
		cancelled = true;
	};
	input.request.signal.addEventListener("abort", cancel, { once: true });
	return new Response(
		new ReadableStream<Uint8Array>({
			async start(controller) {
				let lastSequence = input.after;
				let nextLiveCheckAt = 0;
				const write = (chunkText: string) => {
					if (!cancelled) controller.enqueue(encoder.encode(chunkText));
				};
				write(": connected\n\n");
				try {
					while (true) {
						if (cancelled) break;
						const now = Date.now();
						if (now >= nextLiveCheckAt) {
							nextLiveCheckAt = now + 2_000;
							const live = await liveSessionByKey({
								discoveryDir: input.discoveryDir,
								key: input.registration.key,
							});
							if (live === undefined) break;
						}
						// ponytail: reread the JSONL file; switch to byte tailing when logs get huge.
						const { events } = await readEventLogPath({
							path: input.registration.eventLogPath,
							sessionId: input.registration.sessionId,
						});
						for (const event of events) {
							const sequence = Number(event.sequence);
							if (sequence <= lastSequence) continue;
							lastSequence = sequence;
							write(sseFrame(makePlotEventRecord(event), sequence));
						}
						await sleep(500);
					}
				} finally {
					input.request.signal.removeEventListener("abort", cancel);
					if (!cancelled) controller.close();
				}
			},
			cancel,
		}),
		{
			headers: {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
			},
		},
	);
};

export const startPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<{ readonly url: string; readonly stop: () => void }> => {
	const paths = resolvePlotPaths({
		cwd: options.cwd,
		...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
	});
	const discoveryDir = resolvePlotSessionDiscoveryDir({
		agentDir: paths.agentDir,
	});
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/api/sessions") {
				const sessions = await readLivePlotSessionRegistrations({
					discoveryDir,
				});
				return text({ sessions });
			}
			const eventPath = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
			if (eventPath !== null) {
				const after = parseAfterSequence(url.searchParams.get("after"));
				if (after === undefined)
					return text({ error: "invalid after sequence" });
				const registration = await liveSessionByKey({
					discoveryDir,
					key: decodeURIComponent(eventPath[1] ?? ""),
				});
				if (registration === undefined)
					return new Response("session not found", { status: 404 });
				return sessionEventsResponse({
					request,
					discoveryDir,
					registration,
					after,
				});
			}
			if (url.pathname === "/api/health")
				return text({ ok: true, discoveryDir });
			return assetResponse(url.pathname);
		},
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot web: ${url}\n`);
	if (options.open !== false) await (options.openUrl ?? openBrowser)(url);
	return { url, stop: () => server.stop(true) };
};

export const runPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<void> => {
	await startPlotWebGateway(options);
	await new Promise<void>(() => {});
};
