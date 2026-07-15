import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ExtensionOAuthCallback } from "@plot/sdk";

export interface LoopbackOAuthCallback extends ExtensionOAuthCallback {
	readonly cancel: () => void;
}

export const createLoopbackOAuthCallback = async (
	timeoutMs = 5 * 60_000,
): Promise<LoopbackOAuthCallback> => {
	const path = `/oauth/callback/${randomUUID()}`;
	let resolve!: (code: string) => void;
	let reject!: (error: Error) => void;
	let settled = false;
	const result = new Promise<string>((resolveResult, rejectResult) => {
		resolve = resolveResult;
		reject = rejectResult;
	});
	const finish = (error: Error | undefined, code?: string) => {
		if (settled) return;
		settled = true;
		if (error !== undefined) reject(error);
		else resolve(code!);
	};
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://127.0.0.1");
		if (url.pathname !== path) {
			response.writeHead(404).end("Not found");
			return;
		}
		const oauthError = url.searchParams.get("error");
		const code = url.searchParams.get("code");
		if (oauthError !== null) {
			finish(new Error(`OAuth authorization failed: ${oauthError}`));
			response
				.writeHead(400)
				.end("Authorization failed. You can close this window.");
			return;
		}
		if (code === null || code.length === 0) {
			response.writeHead(400).end("Missing authorization code.");
			return;
		}
		finish(undefined, code);
		response
			.writeHead(200)
			.end("Authorization complete. You can close this window.");
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});
	const address = server.address() as AddressInfo;
	const close = () => {
		server.close();
		server.closeAllConnections?.();
	};
	const timeout = setTimeout(
		() => finish(new Error("OAuth callback timed out")),
		timeoutMs,
	);
	timeout.unref?.();
	return {
		redirectUri: `http://127.0.0.1:${address.port}${path}`,
		wait: async (options) => {
			const signal = options?.signal;
			const onAbort = () => finish(new Error("OAuth callback cancelled"));
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort, { once: true });
			try {
				return await result;
			} finally {
				signal?.removeEventListener("abort", onAbort);
				clearTimeout(timeout);
				close();
			}
		},
		cancel: () => {
			finish(new Error("OAuth callback cancelled"));
			clearTimeout(timeout);
			close();
		},
	};
};
