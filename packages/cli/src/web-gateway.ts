import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import { openOrStartRunIpc, type RunIpcOptions } from "@plot/session/run-ipc";
import type { RunRecord, RunRegistryRuntime } from "@plot/session/run-registry";
import { isRecord } from "@plot/common/primitives";
import { sessionProtocolVersion } from "@plot/session/protocol";
import {
	applySnapshot,
	emptyProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type DashboardProjection,
	type ProjectableEvent,
} from "@plot/projection";
import { readRunHistory, runHistoryPath } from "@plot/session/run-registry";
import { readAgentTranscript } from "@plot/session/transcript";
import { webAssets, type WebAsset } from "./web-assets.generated.js";

const assets: Record<string, WebAsset> = webAssets;

export interface PlotWebGatewayOptions {
	readonly cwd: string;
	readonly agentDir?: string | undefined;
	readonly registryDir?: string | undefined;
	readonly workflowPath?: string | undefined;
	readonly host?: string | undefined;
	readonly port?: number | undefined;
	readonly open?: boolean | undefined;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly openUrl?: (url: string) => Promise<void> | void;
	readonly cli?: RunIpcOptions["cli"];
}

const text = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		...init,
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

const sseFrame = (event: unknown, id?: number): string =>
	`${id === undefined ? "" : `id: ${id}\n`}event: plot\ndata: ${JSON.stringify(event)}\n\n`;

const runCatalogEventsResponse = (input: {
	readonly request: Request;
	readonly listRuns: () => Promise<readonly RunRecord[]>;
}): Response => {
	const encoder = new TextEncoder();
	let interval: ReturnType<typeof setInterval> | undefined;
	let cancelled = false;
	let previous = "";
	let sequence = 0;
	const cancel = () => {
		cancelled = true;
		if (interval !== undefined) clearInterval(interval);
	};
	input.request.signal.addEventListener("abort", cancel, { once: true });
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				const write = (chunk: string) => {
					if (!cancelled) controller.enqueue(encoder.encode(chunk));
				};
				const emit = async () => {
					try {
						const runs = await input.listRuns();
						const serialized = JSON.stringify(runs);
						if (serialized === previous) return;
						previous = serialized;
						write(sseFrame({ kind: "runs", runs }, ++sequence));
					} catch (error) {
						write(
							sseFrame({ kind: "error", error: String(error) }, ++sequence),
						);
					}
				};
				write(": connected\n\n");
				void emit();
				interval = setInterval(() => void emit(), 1_000);
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

const parseSequence = (value: string | null): number | undefined => {
	if (value === null) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const stringField = (
	body: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = body[key];
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
};

const parseObservationBody = async (
	request: Request,
): Promise<
	| {
			readonly sourceId: string;
			readonly workKey: string;
			readonly actionId: string;
			readonly actionLabel: string;
			readonly comment?: string;
			readonly clientId?: string;
	  }
	| undefined
> => {
	const body = (await request.json().catch(() => undefined)) as
		| Record<string, unknown>
		| undefined;
	if (body === undefined) return undefined;
	const sourceId = stringField(body, "sourceId");
	const workKey = stringField(body, "workKey");
	const actionId = stringField(body, "actionId");
	const actionLabel = stringField(body, "actionLabel");
	if (
		sourceId === undefined ||
		workKey === undefined ||
		actionId === undefined ||
		actionLabel === undefined
	)
		return undefined;
	const comment = stringField(body, "comment");
	const clientId = stringField(body, "clientId");
	return {
		sourceId,
		workKey,
		actionId,
		actionLabel,
		...(comment === undefined ? {} : { comment }),
		...(clientId === undefined ? {} : { clientId }),
	};
};

const parseCreateRunBody = async (
	request: Request,
): Promise<{
	readonly cwd?: string;
	readonly workflowPath?: string;
	readonly label?: string;
}> => {
	if (!request.headers.get("content-type")?.includes("application/json"))
		return {};
	const body = (await request.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;
	return {
		...(typeof body["cwd"] === "string" && body["cwd"].trim() !== ""
			? { cwd: body["cwd"] }
			: {}),
		...(typeof body["workflowPath"] === "string" &&
		body["workflowPath"].trim() !== ""
			? { workflowPath: body["workflowPath"] }
			: {}),
		...(typeof body["label"] === "string" && body["label"].trim() !== ""
			? { label: body["label"] }
			: {}),
	};
};

const parseAfterSequence = (input: {
	readonly header: string | null;
	readonly query: string | null;
}): number | undefined => {
	const header = parseSequence(input.header);
	const query = parseSequence(input.query);
	if (input.header !== null && header === undefined) return undefined;
	if (input.query !== null && query === undefined) return undefined;
	return Math.max(header ?? 0, query ?? 0);
};

const historyPageLimit = 20_000;

const emptyRunProjection = (run: RunRecord): DashboardProjection =>
	emptyProjection(run.sessionId ?? run.id, run.workflowName ?? "workflow", {
		cwd: run.cwd,
		cwdName: run.cwdName ?? basename(run.cwd),
		workflowPath: run.workflowPath ?? "WORKFLOW.md",
		skills: [],
		skillPaths: [],
	});

/** Post-mortem board: replay durable Session History through the shared reducer. */
const replayHistoryProjection = async (
	run: RunRecord,
	historyDir: string,
): Promise<DashboardProjection | undefined> => {
	let projection: DashboardProjection | undefined;
	for await (const event of readRunHistory(
		runHistoryPath(historyDir, run.id),
	)) {
		if (!isRecord(event)) continue;
		projection = reduceProjectableEvent(
			projection ?? emptyRunProjection(run),
			event as ProjectableEvent,
		);
	}
	return projection;
};

const loadRunProjection = async (
	run: RunRecord,
	registry: RunRegistryRuntime,
	historyDir: string,
): Promise<
	| { readonly projection: DashboardProjection; readonly replayed: boolean }
	| undefined
> => {
	const replay = async () => {
		const projection = await replayHistoryProjection(run, historyDir);
		return projection === undefined
			? undefined
			: { projection, replayed: true };
	};
	if (run.sessionId === undefined) return replay();
	const response = await registry
		.submit(run.id, {
			protocol: sessionProtocolVersion,
			kind: "request",
			id: `web_projection_${randomUUID()}`,
			command: "get_snapshot",
		})
		.catch(() => undefined);
	if (response === undefined || response.kind !== "response" || !response.ok)
		return replay();
	const data = isRecord(response.data) ? response.data : {};
	return {
		projection: applySnapshot(emptyRunProjection(run), {
			snapshot: data["snapshot"],
			asOfSequence: response.lastSequence ?? data["lastSequence"],
		}),
		replayed: false,
	};
};

const runProjectionResponse = async (
	run: RunRecord,
	registry: RunRegistryRuntime,
	historyDir: string,
): Promise<Response> => {
	const loaded = await loadRunProjection(run, registry, historyDir);
	if (loaded === undefined)
		return new Response("run not live", { status: 409 });
	return text({
		projection: serializeDashboardProjection(loaded.projection),
		...(loaded.replayed ? { replayed: true } : {}),
	});
};

const runHistoryResponse = async (
	run: RunRecord,
	historyDir: string,
	after: number,
): Promise<Response> => {
	const records: unknown[] = [];
	let truncated = false;
	for await (const event of readRunHistory(
		runHistoryPath(historyDir, run.id),
	)) {
		if (!isRecord(event)) continue;
		const value = event["sequence"];
		if (!Number.isInteger(value)) continue;
		const sequence = value as number;
		if (sequence <= after) continue;
		if (records.length === historyPageLimit) {
			truncated = true;
			break;
		}
		records.push({ kind: "event", sequence, event });
	}
	return text({ records, truncated });
};

/** The transcript path is derived server-side; clients never name files. */
export const runTranscriptResponse = async (
	run: RunRecord,
	attemptRunId: string,
	registry: RunRegistryRuntime,
	historyDir: string,
): Promise<Response> => {
	const loaded = await loadRunProjection(run, registry, historyDir);
	if (loaded === undefined)
		return new Response("run not live", { status: 409 });
	// The live snapshot rebuilds attempts from agent state, which does not
	// carry the plot_transcript event; the durable history does, even for
	// live runs, so fall back to a replay before declaring no transcript.
	const transcriptPathOf = (projection: DashboardProjection) =>
		projection.attempts.get(attemptRunId)?.transcript?.path;
	const path =
		transcriptPathOf(loaded.projection) ??
		(loaded.replayed
			? undefined
			: await replayHistoryProjection(run, historyDir).then((replayed) =>
					replayed === undefined ? undefined : transcriptPathOf(replayed),
				));
	if (path === undefined)
		return new Response("no transcript recorded", { status: 404 });
	return text({ entries: await readAgentTranscript(path) });
};

const sessionEventsResponse = (input: {
	readonly request: Request;
	readonly records: AsyncIterable<unknown>;
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
				const write = (chunkText: string) => {
					if (!cancelled) controller.enqueue(encoder.encode(chunkText));
				};
				write(": connected\n\n");
				try {
					for await (const record of input.records) {
						if (cancelled) break;
						const event =
							typeof record === "object" && record !== null && "kind" in record
								? (record as {
										readonly kind?: string;
										readonly event?: { readonly sequence?: number };
									})
								: undefined;
						write(sseFrame(record, event?.event?.sequence));
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
	const runIpc = await openOrStartRunIpc({
		cwd: options.cwd,
		...(options.registryDir === undefined
			? {}
			: { runRegistryDir: options.registryDir }),
		...(options.cli === undefined ? {} : { cli: options.cli }),
	});
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		idleTimeout: 255,
		async fetch(request) {
			try {
				const url = new URL(request.url);
				if (url.pathname === "/api/runs/events")
					return runCatalogEventsResponse({
						request,
						listRuns: () => runIpc.runRegistry.list(),
					});
				if (url.pathname === "/api/runs" && request.method === "POST") {
					const body = await parseCreateRunBody(request);
					const run = await runIpc.runRegistry.spawn({
						cwd: body.cwd ?? options.cwd,
						...(body.workflowPath !== undefined
							? { workflowPath: body.workflowPath }
							: options.workflowPath === undefined
								? {}
								: { workflowPath: options.workflowPath }),
						...(body.label === undefined ? {} : { label: body.label }),
					});
					return text({ run });
				}
				const stopPath = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
				if (stopPath !== null && request.method === "DELETE") {
					const run = await runIpc.runRegistry.stop(
						decodeURIComponent(stopPath[1] ?? ""),
					);
					return run === undefined
						? new Response("run not found", { status: 404 })
						: text({ run });
				}
				if (url.pathname === "/api/runs") {
					const runs = await runIpc.runRegistry
						.list()
						.then((value) => ({ ok: true as const, value }))
						.catch((error: unknown) => ({ ok: false as const, error }));
					return runs.ok
						? text({ runs: runs.value })
						: text({ error: String(runs.error) }, { status: 503 });
				}
				const observationPath = /^\/api\/runs\/([^/]+)\/observations$/.exec(
					url.pathname,
				);
				if (observationPath !== null && request.method === "POST") {
					const id = decodeURIComponent(observationPath[1] ?? "");
					const run = await runIpc.runRegistry.status(id);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					const body = await parseObservationBody(request);
					if (body === undefined)
						return text({ error: "invalid observation body" }, { status: 400 });
					const response = await runIpc.runRegistry
						.submit(id, {
							protocol: sessionProtocolVersion,
							kind: "request",
							id: `web_observation_${randomUUID()}`,
							command: "record_operator_observation",
							params: { ...body, actor: "web" },
						})
						.catch(() => undefined);
					if (
						response === undefined ||
						response.kind !== "response" ||
						!response.ok
					)
						return text({ error: "run not live" }, { status: 409 });
					return text({
						accepted:
							isRecord(response.data) && response.data["accepted"] === true,
					});
				}
				const eventPath = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
				if (eventPath !== null) {
					const after = parseAfterSequence({
						header: request.headers.get("last-event-id"),
						query: url.searchParams.get("after"),
					});
					if (after === undefined)
						return text({ error: "invalid after sequence" });
					const id = decodeURIComponent(eventPath[1] ?? "");
					const run = await runIpc.runRegistry.status(id);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					return sessionEventsResponse({
						request,
						records: runIpc.runRegistry.attachRecords(id, after),
					});
				}
				const historyPath = /^\/api\/runs\/([^/]+)\/history$/.exec(
					url.pathname,
				);
				if (historyPath !== null) {
					const after = parseSequence(url.searchParams.get("after"));
					if (after === undefined)
						return text({ error: "invalid after sequence" });
					const run = await runIpc.runRegistry.status(
						decodeURIComponent(historyPath[1] ?? ""),
					);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					return runHistoryResponse(run, runIpc.historyDir, after);
				}
				const transcriptPath =
					/^\/api\/runs\/([^/]+)\/attempts\/([^/]+)\/transcript$/.exec(
						url.pathname,
					);
				if (transcriptPath !== null) {
					const run = await runIpc.runRegistry.status(
						decodeURIComponent(transcriptPath[1] ?? ""),
					);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					return runTranscriptResponse(
						run,
						decodeURIComponent(transcriptPath[2] ?? ""),
						runIpc.runRegistry,
						runIpc.historyDir,
					);
				}
				const projectionPath = /^\/api\/runs\/([^/]+)\/projection$/.exec(
					url.pathname,
				);
				if (projectionPath !== null) {
					const run = await runIpc.runRegistry.status(
						decodeURIComponent(projectionPath[1] ?? ""),
					);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					return runProjectionResponse(
						run,
						runIpc.runRegistry,
						runIpc.historyDir,
					);
				}
				if (url.pathname === "/api/health")
					return text({ ok: true, socketPath: runIpc.socketPath });
				return assetResponse(url.pathname);
			} catch (error) {
				return text({ error: String(error) }, { status: 503 });
			}
		},
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot web: ${url}\n`);
	if (options.open !== false) await (options.openUrl ?? openBrowser)(url);
	return {
		url,
		stop: () => {
			server.stop(true);
			void runIpc.close();
		},
	};
};

export const runPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<void> => {
	await startPlotWebGateway(options);
	await new Promise<void>(() => {});
};
