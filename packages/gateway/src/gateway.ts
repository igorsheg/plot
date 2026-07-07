import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { AsyncQueue } from "@plot/common/async-queue";
import { openOrStartRunIpc, type RunIpcOptions } from "@plot/registry/ipc";
import type { RunRecord } from "@plot/registry/record";
import { isRecord, type Mutable } from "@plot/common/primitives";
import {
	sessionProtocolVersion,
	type ServerRecord,
} from "@plot/session/protocol";
import type { RuntimeEvent } from "@plot/session/runtime";
import {
	emptyProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type DashboardProjection,
} from "@plot/projection";
import { readSessionEvents } from "@plot/session/history";
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

type RunIpcConnection = Awaited<ReturnType<typeof openOrStartRunIpc>>;

const text = (body: unknown, init: ResponseInit = {}) =>
	new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json; charset=utf-8" },
	});

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
	const action: Mutable<{
		readonly sourceId: string;
		readonly workKey: string;
		readonly actionId: string;
		readonly actionLabel: string;
		readonly comment?: string;
		readonly clientId?: string;
	}> = {
		sourceId,
		workKey,
		actionId,
		actionLabel,
	};
	if (comment !== undefined) action.comment = comment;
	if (clientId !== undefined) action.clientId = clientId;
	return action;
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
	const result: Mutable<Awaited<ReturnType<typeof parseCreateRunBody>>> = {};
	if (typeof body["cwd"] === "string" && body["cwd"].trim() !== "")
		result.cwd = body["cwd"];
	if (
		typeof body["workflowPath"] === "string" &&
		body["workflowPath"].trim() !== ""
	)
		result.workflowPath = body["workflowPath"];
	if (typeof body["label"] === "string" && body["label"].trim() !== "")
		result.label = body["label"];
	return result;
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

const sessionEventsPageLimit = 20_000;

const emptyRunProjection = (run: RunRecord): DashboardProjection =>
	emptyProjection(run.sessionId ?? run.id, run.workflowName ?? "workflow", {
		cwd: run.cwd,
		cwdName: run.cwdName ?? basename(run.cwd),
		workflowPath: run.workflowPath ?? "WORKFLOW.md",
		skills: [],
		skillPaths: [],
	});

/** Dashboard baseline: replay the session-owned durable event log. */
const replaySessionProjection = async (
	run: RunRecord,
): Promise<DashboardProjection | undefined> => {
	if (run.sessionFile === undefined) return undefined;
	let projection: DashboardProjection | undefined;
	for await (const event of readSessionEvents(run.sessionFile)) {
		projection = reduceProjectableEvent(
			projection ?? emptyRunProjection(run),
			event,
		);
	}
	return projection;
};

const toServerEventRecord = (event: RuntimeEvent): ServerRecord => ({
	protocol: sessionProtocolVersion,
	kind: "event",
	event,
});

const eventRecordSequence = (record: ServerRecord): number | undefined =>
	record.kind === "event" ? record.event.sequence : undefined;

export async function* gaplessRunEventRecords(input: {
	readonly sessionFile: string;
	readonly after: number;
	readonly liveRecords: AsyncIterable<ServerRecord>;
}): AsyncIterable<ServerRecord> {
	let frontier = input.after;
	const liveQueue = new AsyncQueue<ServerRecord>();
	const liveIterator = input.liveRecords[Symbol.asyncIterator]();
	const pump = (async () => {
		try {
			for (;;) {
				// eslint-disable-next-line no-await-in-loop -- live pump waits for each child event in order.
				const next = await liveIterator.next();
				if (next.done === true) break;
				liveQueue.offer(next.value, { force: true });
			}
		} catch (error) {
			liveQueue.fail(error);
		} finally {
			liveQueue.close();
		}
	})();
	const unseen = (record: ServerRecord): boolean => {
		const sequence = eventRecordSequence(record);
		if (sequence === undefined || sequence <= frontier) return false;
		frontier = sequence;
		return true;
	};
	try {
		for await (const event of readSessionEvents(input.sessionFile)) {
			const record = toServerEventRecord(event);
			if (unseen(record)) yield record;
		}
		for await (const record of liveQueue) if (unseen(record)) yield record;
	} finally {
		await liveIterator.return?.();
		await pump.catch(() => undefined);
	}
}

const runProjectionResponse = async (run: RunRecord): Promise<Response> => {
	const projection = await replaySessionProjection(run);
	if (projection === undefined)
		return new Response("run has no session event log", { status: 409 });
	return text({ projection: serializeDashboardProjection(projection) });
};

const runSessionEventsResponse = async (
	run: RunRecord,
	after: number,
): Promise<Response> => {
	if (run.sessionFile === undefined)
		return new Response("run has no session event log", { status: 409 });
	const records: unknown[] = [];
	let truncated = false;
	for await (const event of readSessionEvents(run.sessionFile)) {
		const sequence = event.sequence;
		if (sequence <= after) continue;
		if (records.length === sessionEventsPageLimit) {
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
): Promise<Response> => {
	const projection = await replaySessionProjection(run);
	if (projection === undefined)
		return new Response("run has no session event log", { status: 409 });
	const path = projection.attempts.get(attemptRunId)?.transcript?.path;
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

const spawnRunResponse = async (
	request: Request,
	options: PlotWebGatewayOptions,
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const body = await parseCreateRunBody(request);
	const spawnInput: Mutable<Parameters<typeof runIpc.runRegistry.spawn>[0]> = {
		cwd: body.cwd ?? options.cwd,
	};
	if (body.workflowPath !== undefined)
		spawnInput.workflowPath = body.workflowPath;
	else if (options.workflowPath !== undefined)
		spawnInput.workflowPath = options.workflowPath;
	if (body.label !== undefined) spawnInput.label = body.label;
	const run = await runIpc.runRegistry.spawn(spawnInput);
	return text({ run });
};

const listRunsResponse = async (
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const runs = await runIpc.runRegistry
		.list()
		.then((value) => ({ ok: true as const, value }))
		.catch((error: unknown) => ({ ok: false as const, error }));
	return runs.ok
		? text({ runs: runs.value })
		: text({ error: String(runs.error) }, { status: 503 });
};

const stopRunResponse = async (
	id: string,
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const run = await runIpc.runRegistry.stop(id);
	return run === undefined
		? new Response("run not found", { status: 404 })
		: text({ run });
};

const runResponse = async (
	id: string,
	runIpc: RunIpcConnection,
	handle: (run: RunRecord) => Promise<Response> | Response,
): Promise<Response> => {
	const run = await runIpc.runRegistry.status(id);
	return run === undefined
		? new Response("run not found", { status: 404 })
		: handle(run);
};

const operatorObservationResponse = async (
	request: Request,
	id: string,
	runIpc: RunIpcConnection,
): Promise<Response> =>
	runResponse(id, runIpc, async () => {
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
		if (response === undefined || response.kind !== "response" || !response.ok)
			return text({ error: "run not live" }, { status: 409 });
		return text({
			accepted: isRecord(response.data) && response.data["accepted"] === true,
		});
	});

const runEventsEndpointResponse = async (
	request: Request,
	url: URL,
	id: string,
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const after = parseAfterSequence({
		header: request.headers.get("last-event-id"),
		query: url.searchParams.get("after"),
	});
	if (after === undefined) return text({ error: "invalid after sequence" });
	return runResponse(id, runIpc, (run) => {
		if (run.sessionFile === undefined)
			return new Response("run has no session event log", { status: 409 });
		return sessionEventsResponse({
			request,
			records: gaplessRunEventRecords({
				sessionFile: run.sessionFile,
				after,
				liveRecords: runIpc.runRegistry.attachRecords(id, after),
			}),
		});
	});
};

const runSessionEventsEndpointResponse = async (
	url: URL,
	id: string,
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const after = parseSequence(url.searchParams.get("after"));
	if (after === undefined) return text({ error: "invalid after sequence" });
	return runResponse(id, runIpc, (run) => runSessionEventsResponse(run, after));
};

const runTranscriptEndpointResponse = async (
	runId: string,
	attemptRunId: string,
	runIpc: RunIpcConnection,
): Promise<Response> =>
	runResponse(runId, runIpc, (run) => runTranscriptResponse(run, attemptRunId));

const runProjectionEndpointResponse = async (
	id: string,
	runIpc: RunIpcConnection,
): Promise<Response> => runResponse(id, runIpc, runProjectionResponse);

const gatewayResponse = async (
	request: Request,
	options: PlotWebGatewayOptions,
	runIpc: RunIpcConnection,
): Promise<Response> => {
	const url = new URL(request.url);
	if (url.pathname === "/api/runs/events")
		return runCatalogEventsResponse({
			request,
			listRuns: () => runIpc.runRegistry.list(),
		});
	if (url.pathname === "/api/runs" && request.method === "POST")
		return spawnRunResponse(request, options, runIpc);
	const stopPath = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
	if (stopPath !== null && request.method === "DELETE")
		return stopRunResponse(decodeURIComponent(stopPath[1] ?? ""), runIpc);
	if (url.pathname === "/api/runs") return listRunsResponse(runIpc);
	const observationPath = /^\/api\/runs\/([^/]+)\/observations$/.exec(
		url.pathname,
	);
	if (observationPath !== null && request.method === "POST")
		return operatorObservationResponse(
			request,
			decodeURIComponent(observationPath[1] ?? ""),
			runIpc,
		);
	const eventPath = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
	if (eventPath !== null)
		return runEventsEndpointResponse(
			request,
			url,
			decodeURIComponent(eventPath[1] ?? ""),
			runIpc,
		);
	const sessionEventsPath = /^\/api\/runs\/([^/]+)\/session-events$/.exec(
		url.pathname,
	);
	if (sessionEventsPath !== null)
		return runSessionEventsEndpointResponse(
			url,
			decodeURIComponent(sessionEventsPath[1] ?? ""),
			runIpc,
		);
	const transcriptPath =
		/^\/api\/runs\/([^/]+)\/attempts\/([^/]+)\/transcript$/.exec(url.pathname);
	if (transcriptPath !== null)
		return runTranscriptEndpointResponse(
			decodeURIComponent(transcriptPath[1] ?? ""),
			decodeURIComponent(transcriptPath[2] ?? ""),
			runIpc,
		);
	const projectionPath = /^\/api\/runs\/([^/]+)\/projection$/.exec(
		url.pathname,
	);
	if (projectionPath !== null)
		return runProjectionEndpointResponse(
			decodeURIComponent(projectionPath[1] ?? ""),
			runIpc,
		);
	if (url.pathname === "/api/health")
		return text({ ok: true, socketPath: runIpc.socketPath });
	return assetResponse(url.pathname);
};

export const startPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<{ readonly url: string; readonly stop: () => void }> => {
	const runIpcOptions: Mutable<RunIpcOptions> = { cwd: options.cwd };
	if (options.registryDir !== undefined)
		runIpcOptions.runRegistryDir = options.registryDir;
	if (options.cli !== undefined) runIpcOptions.cli = options.cli;
	const runIpc = await openOrStartRunIpc(runIpcOptions);
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		idleTimeout: 255,
		async fetch(request) {
			try {
				return await gatewayResponse(request, options, runIpc);
			} catch (error) {
				return text({ error: String(error) }, { status: 503 });
			}
		},
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot web: ${url}\n`);
	if (options.open !== false && options.openUrl !== undefined)
		await options.openUrl(url);
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
