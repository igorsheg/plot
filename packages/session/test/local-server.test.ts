import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { PlotSessionSummary } from "@plot/control/session-summary";
import { ensureLocalControlToken } from "../src/local-server-auth.js";
import {
	readLocalPlotServerMetadata,
	writeLocalPlotServerMetadata,
} from "../src/local-server-metadata.js";
import { resolveLocalPlotServerPaths } from "../src/local-server-paths.js";
import { startLocalPlotServer } from "../src/local-server.js";
import {
	applyStoppedOneshotRetention,
	catalogEntryFromSummary,
	readPlotSessionCatalog,
	refreshPlotSessionCatalogFromHistory,
	upsertPlotSessionCatalogEntry,
} from "../src/session-catalog.js";
import { plotProtocolVersion } from "../src/protocol.js";

const tmpPaths = async () =>
	resolveLocalPlotServerPaths({
		serverDir: await mkdtemp(join(tmpdir(), "plot-local-server-")),
	});

const summary = (input: {
	readonly id: string;
	readonly state?: PlotSessionSummary["state"];
	readonly mode?: PlotSessionSummary["mode"];
	readonly updatedAt?: string;
}): PlotSessionSummary => ({
	id: input.id,
	epoch: `epoch-${input.id}`,
	mode: input.mode ?? "oneshot",
	state: input.state ?? "stopped",
	workflowName: "workflow",
	workflowPath: "/repo/WORKFLOW.md",
	cwd: "/repo",
	cwdName: "repo",
	agents: { active: 0, max: 1 },
	needsYouCount: 0,
	tokenThroughputPerSecond: null,
	totalTokens: 0,
	lastActivityAt: input.updatedAt ?? null,
	attachments: { observers: 0, controllers: 0 },
});

const makeHistory = async (root: string, id: string) => {
	const dir = join(root, id);
	await mkdir(dir, { recursive: true });
	const historyPath = join(dir, "history.jsonl");
	await writeFile(historyPath, "");
	return historyPath;
};

const waitForMessage = (ws: WebSocket): Promise<unknown> =>
	new Promise((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error("timed out waiting for websocket message")),
			2_000,
		);
		ws.addEventListener(
			"message",
			(event) => {
				clearTimeout(timeout);
				resolve(JSON.parse(String(event.data)) as unknown);
			},
			{ once: true },
		);
	});

describe("Local Plot Server", () => {
	test("generates a persistent local token and rejects missing or wrong tokens", async () => {
		const paths = await tmpPaths();
		const token = await ensureLocalControlToken(paths);
		const again = await ensureLocalControlToken(paths);
		expect(again).toEqual(token);
		const mode = (await stat(paths.tokenPath)).mode & 0o777;
		expect(mode & 0o077).toBe(0);

		const server = await startLocalPlotServer({
			serverDir: paths.serverDir,
			port: 0,
		});
		try {
			expect((await fetch(`${server.url}/health`)).status).toBe(401);
			expect(
				(
					await fetch(`${server.url}/health`, {
						headers: { authorization: "Bearer wrong" },
					})
				).status,
			).toBe(401);
			const ok = await fetch(`${server.url}/health`, {
				headers: { authorization: `Bearer ${token.token}` },
			});
			expect(ok.status).toBe(200);
			expect(await ok.json()).toEqual(
				expect.objectContaining({
					name: "plot-local-server",
					tokenFingerprint: token.fingerprint,
				}),
			);
		} finally {
			await server.stop();
		}
	});

	test("recovers stale local metadata by health check instead of PID trust", async () => {
		const paths = await tmpPaths();
		const token = await ensureLocalControlToken(paths);
		await writeLocalPlotServerMetadata(paths, {
			url: "http://127.0.0.1:1",
			pid: process.pid,
			startedAt: "2000-01-01T00:00:00.000Z",
			tokenFingerprint: token.fingerprint,
		});

		const server = await startLocalPlotServer({
			serverDir: paths.serverDir,
			port: 0,
		});
		try {
			expect(server.alreadyRunning).toBe(false);
			const metadata = await readLocalPlotServerMetadata(paths);
			expect(metadata?.url).toBe(server.url);
			expect(metadata?.url).not.toBe("http://127.0.0.1:1");
		} finally {
			await server.stop();
		}
	});

	test("falls back to an ephemeral port when the stable port is occupied by something else", async () => {
		const dummy = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => new Response("not plot"),
		});
		const paths = await tmpPaths();
		const stablePort = dummy.port;
		if (stablePort === undefined) throw new Error("dummy server has no port");
		const server = await startLocalPlotServer({
			serverDir: paths.serverDir,
			hostname: "127.0.0.1",
			stablePort,
		});
		try {
			expect(server.alreadyRunning).toBe(false);
			expect(new URL(server.url).port).not.toBe(String(stablePort));
		} finally {
			await server.stop();
			dummy.stop(true);
		}
	});

	test("WebSocket clients receive welcome and can list sessions", async () => {
		const paths = await tmpPaths();
		const server = await startLocalPlotServer({
			serverDir: paths.serverDir,
			port: 0,
		});
		try {
			const wsUrl = `${server.url.replace("http:", "ws:")}/ws?token=${server.token.token}`;
			const ws = new WebSocket(wsUrl);
			const welcome = await waitForMessage(ws);
			expect(welcome).toEqual(expect.objectContaining({ kind: "welcome" }));
			ws.send(
				JSON.stringify({
					protocol: plotProtocolVersion,
					kind: "request",
					id: "list-1",
					command: "list_sessions",
				}),
			);
			const response = await waitForMessage(ws);
			expect(response).toEqual(
				expect.objectContaining({
					kind: "response",
					id: "list-1",
					ok: true,
					data: { sessions: [] },
				}),
			);
			ws.close();
		} finally {
			await server.stop();
		}
	});

	test("catalog marks missing history stale and does not treat the index as source of truth", async () => {
		const paths = await tmpPaths();
		const historyRoot = await mkdtemp(join(tmpdir(), "plot-history-"));
		const historyPath = await makeHistory(historyRoot, "s1");
		await upsertPlotSessionCatalogEntry(
			paths,
			catalogEntryFromSummary({ summary: summary({ id: "s1" }), historyPath }),
		);
		expect(
			(await refreshPlotSessionCatalogFromHistory(paths)).entries[0]?.stale,
		).toBe(false);
		const cached = JSON.parse(await readFile(paths.catalogPath, "utf8")) as {
			entries: [{ summary: { workflowName: string } }];
		};
		cached.entries[0].summary.workflowName = "cached-only";
		await writeFile(paths.catalogPath, JSON.stringify(cached));
		expect(await readFile(historyPath, "utf8")).toBe("");
		await Bun.file(historyPath).delete();
		expect(
			(await refreshPlotSessionCatalogFromHistory(paths)).entries[0]?.stale,
		).toBe(true);
	});

	test("stopped oneshot retention prunes index entries and project histories only for prunable sessions", async () => {
		const paths = await tmpPaths();
		const historyRoot = await mkdtemp(join(tmpdir(), "plot-retention-"));
		const now = "2026-06-15T00:00:00.000Z";
		const entries = [
			{ id: "newest", updatedAt: "2026-06-14T23:59:59.000Z" },
			{ id: "second", updatedAt: "2026-06-14T23:59:58.000Z" },
			{ id: "third", updatedAt: "2026-06-14T23:59:57.000Z" },
			{ id: "old", updatedAt: "2026-06-01T00:00:00.000Z" },
		];
		for (const entry of entries) {
			const historyPath = await makeHistory(historyRoot, entry.id);
			await upsertPlotSessionCatalogEntry(
				paths,
				catalogEntryFromSummary({
					summary: summary({ id: entry.id, updatedAt: entry.updatedAt }),
					historyPath,
					now: entry.updatedAt,
				}),
			);
		}
		const activeHistory = await makeHistory(historyRoot, "active");
		await upsertPlotSessionCatalogEntry(
			paths,
			catalogEntryFromSummary({
				summary: summary({ id: "active", mode: "watch", state: "watching" }),
				historyPath: activeHistory,
				now: "2026-01-01T00:00:00.000Z",
			}),
		);

		const result = await applyStoppedOneshotRetention({
			paths,
			now,
			maxStoppedOneshot: 2,
			maxAgeMs: 7 * 24 * 60 * 60 * 1000,
		});
		expect(result.pruned.map((entry) => entry.sessionId).toSorted()).toEqual([
			"old",
			"third",
		]);
		expect(
			(await readPlotSessionCatalog(paths)).entries
				.map((entry) => entry.sessionId)
				.toSorted(),
		).toEqual(["active", "newest", "second"]);
		expect(
			await Bun.file(join(historyRoot, "third", "history.jsonl")).exists(),
		).toBe(false);
		expect(await Bun.file(activeHistory).exists()).toBe(true);
	});
});
