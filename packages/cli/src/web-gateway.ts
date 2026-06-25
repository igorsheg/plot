import { spawn } from "node:child_process";
import { resolvePlotPaths } from "@plot/session/plot-paths";
import {
	readLivePlotSessionRegistrations,
	resolvePlotSessionDiscoveryDir,
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
	const path = pathname === "/" ? "/index.html" : pathname;
	const asset = assets[path];
	if (asset === undefined) return new Response("not found", { status: 404 });
	return new Response(Buffer.from(asset.bodyBase64, "base64"), {
		headers: { "content-type": asset.contentType },
	});
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
