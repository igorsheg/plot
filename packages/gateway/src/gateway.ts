import { basename } from "node:path";
import type { SessionManagerRuntime } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import { isRecord } from "@plot/common/primitives";
import {
	emptyProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type DashboardProjection,
} from "@plot/projection";
import { readSessionEvents } from "@plot/session/history";
import type {
	OperatorObservationInput,
	RuntimeEvent,
	SourceActionInput,
} from "@plot/session/runtime";
import { readAgentTranscript } from "@plot/session/transcript";
import { webAssets, type WebAsset } from "./web-assets.generated.js";

const assets: Record<string, WebAsset> = webAssets;

export interface PlotWebGatewayOptions {
	readonly host?: string;
	readonly port?: number;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly openUrl?: (url: string) => Promise<void> | void;
	readonly manager: SessionManagerRuntime;
}

const json = (body: unknown, init: ResponseInit = {}) =>
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

const sseFrame = (event: unknown, id: number): string =>
	`id: ${id}\nevent: plot\ndata: ${JSON.stringify(event)}\n\n`;

const parseSequence = (value: string | null): number | undefined => {
	if (value === null) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseAfter = (request: Request, url: URL): number | undefined => {
	const headerValue = request.headers.get("last-event-id");
	const queryValue = url.searchParams.get("after");
	const header = parseSequence(headerValue);
	const query = parseSequence(queryValue);
	if (headerValue !== null && header === undefined) return undefined;
	if (queryValue !== null && query === undefined) return undefined;
	return Math.max(header ?? 0, query ?? 0);
};

const nonEmptyString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value : undefined;

const parseSourceAction = async (
	request: Request,
): Promise<SourceActionInput | undefined> => {
	const value = await request.json().catch(() => undefined);
	if (!isRecord(value)) return;
	const sourceId = nonEmptyString(value["sourceId"]);
	const requirementId = nonEmptyString(value["requirementId"]);
	const actionId = nonEmptyString(value["actionId"]);
	if (
		sourceId === undefined ||
		requirementId === undefined ||
		actionId === undefined
	)
		return;
	return { sourceId, requirementId, actionId };
};

const parseObservation = async (
	request: Request,
): Promise<OperatorObservationInput | undefined> => {
	const value = await request.json().catch(() => undefined);
	if (!isRecord(value)) return;
	const sourceId = nonEmptyString(value["sourceId"]);
	const workKey = nonEmptyString(value["workKey"]);
	const actionId = nonEmptyString(value["actionId"]);
	const actionLabel = nonEmptyString(value["actionLabel"]);
	if (
		sourceId === undefined ||
		workKey === undefined ||
		actionId === undefined ||
		actionLabel === undefined
	)
		return;
	const input: {
		sourceId: string;
		workKey: string;
		actionId: string;
		actionLabel: string;
		actor: string;
		comment?: string;
		clientId?: string;
	} = { sourceId, workKey, actionId, actionLabel, actor: "web" };
	if (typeof value["comment"] === "string") input.comment = value["comment"];
	if (typeof value["clientId"] === "string") input.clientId = value["clientId"];
	return input;
};

const parseStart = async (
	request: Request,
): Promise<{ cwd: string; workflowPath?: string } | undefined> => {
	const value = await request.json().catch(() => undefined);
	if (!isRecord(value)) return;
	const cwd = nonEmptyString(value["cwd"]);
	if (cwd === undefined) return;
	const workflowPath = nonEmptyString(value["workflowPath"]);
	return workflowPath === undefined ? { cwd } : { cwd, workflowPath };
};

const emptySessionProjection = (session: SessionSummary): DashboardProjection =>
	emptyProjection(session.id, session.workflowName, {
		cwd: session.projectPath,
		cwdName: basename(session.projectPath),
		workflowPath: session.workflowPath,
		skills: [],
		skillPaths: [],
	});

const replayProjection = async (
	session: SessionSummary,
): Promise<DashboardProjection> => {
	let projection = emptySessionProjection(session);
	for await (const event of readSessionEvents(session.historyPath))
		projection = reduceProjectableEvent(projection, event);
	return projection;
};

const withSession = async (
	manager: SessionManagerRuntime,
	id: string,
	handle: (session: SessionSummary) => Promise<Response> | Response,
): Promise<Response> => {
	const session = await manager.get(id);
	return session === undefined
		? new Response("Session not found", { status: 404 })
		: handle(session);
};

const eventsResponse = (input: {
	readonly request: Request;
	readonly events: (signal: AbortSignal) => AsyncIterable<RuntimeEvent>;
}): Response => {
	const encoder = new TextEncoder();
	const eventController = new AbortController();
	const iterator = input.events(eventController.signal)[Symbol.asyncIterator]();
	let cancelled = false;
	const cancel = () => {
		cancelled = true;
		eventController.abort();
		void iterator.return?.();
	};
	input.request.signal.addEventListener("abort", cancel, { once: true });
	return new Response(
		new ReadableStream<Uint8Array>({
			async start(controller) {
				const write = (text: string) => {
					if (!cancelled) controller.enqueue(encoder.encode(text));
				};
				write(": connected\n\n");
				try {
					for (;;) {
						// eslint-disable-next-line no-await-in-loop -- Session events are ordered.
						const next = await iterator.next();
						if (next.done || cancelled) break;
						write(
							sseFrame(
								{ kind: "event", event: next.value },
								next.value.sequence,
							),
						);
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

export const sessionTranscriptResponse = async (
	session: SessionSummary,
	attemptRunId: string,
): Promise<Response> => {
	const projection = await replayProjection(session);
	const path = projection.attempts.get(attemptRunId)?.transcript?.path;
	if (path === undefined)
		return new Response("no transcript recorded", { status: 404 });
	return json({ entries: await readAgentTranscript(path) });
};

const gatewayResponse = async (
	request: Request,
	manager: SessionManagerRuntime,
): Promise<Response> => {
	const url = new URL(request.url);
	if (url.pathname === "/api/sessions" && request.method === "POST") {
		const input = await parseStart(request);
		if (input === undefined)
			return json({ error: "invalid Session body" }, { status: 400 });
		return json(await manager.start(input));
	}
	if (url.pathname === "/api/sessions")
		return json({ sessions: await manager.list() });
	const sessionPath = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
	if (sessionPath !== null && request.method === "DELETE") {
		const session = await manager.stopSession(
			decodeURIComponent(sessionPath[1] ?? ""),
		);
		return session === undefined
			? new Response("Session not found", { status: 404 })
			: json({ session });
	}
	const projectionPath = /^\/api\/sessions\/([^/]+)\/projection$/.exec(
		url.pathname,
	);
	if (projectionPath !== null)
		return withSession(
			manager,
			decodeURIComponent(projectionPath[1] ?? ""),
			async (session) =>
				json({
					projection: serializeDashboardProjection(
						await replayProjection(session),
					),
				}),
		);
	const eventsPath = /^\/api\/sessions\/([^/]+)\/events$/.exec(url.pathname);
	if (eventsPath !== null) {
		const after = parseAfter(request, url);
		if (after === undefined)
			return json({ error: "invalid after sequence" }, { status: 400 });
		const id = decodeURIComponent(eventsPath[1] ?? "");
		return withSession(manager, id, () =>
			eventsResponse({
				request,
				events: (signal) => manager.events(id, after, signal),
			}),
		);
	}
	const observationPath = /^\/api\/sessions\/([^/]+)\/observations$/.exec(
		url.pathname,
	);
	if (observationPath !== null && request.method === "POST") {
		const input = await parseObservation(request);
		if (input === undefined)
			return json({ error: "invalid observation" }, { status: 400 });
		return json({
			accepted: await manager.observe(
				decodeURIComponent(observationPath[1] ?? ""),
				input,
			),
		});
	}
	const sourceActionPath = /^\/api\/sessions\/([^/]+)\/source-actions$/.exec(
		url.pathname,
	);
	if (sourceActionPath !== null && request.method === "POST") {
		const input = await parseSourceAction(request);
		if (input === undefined)
			return json({ error: "invalid Source action" }, { status: 400 });
		return json(
			await manager.startSourceAction(
				decodeURIComponent(sourceActionPath[1] ?? ""),
				input,
			),
		);
	}
	const cancelPath = /^\/api\/sessions\/([^/]+)\/source-actions\/([^/]+)$/.exec(
		url.pathname,
	);
	if (cancelPath !== null && request.method === "DELETE")
		return json({
			accepted: await manager.cancelSourceAction(
				decodeURIComponent(cancelPath[1] ?? ""),
				decodeURIComponent(cancelPath[2] ?? ""),
			),
		});
	const transcriptPath =
		/^\/api\/sessions\/([^/]+)\/attempts\/([^/]+)\/transcript$/.exec(
			url.pathname,
		);
	if (transcriptPath !== null)
		return withSession(
			manager,
			decodeURIComponent(transcriptPath[1] ?? ""),
			(session) =>
				sessionTranscriptResponse(
					session,
					decodeURIComponent(transcriptPath[2] ?? ""),
				),
		);
	if (url.pathname === "/api/health") return json({ ok: true });
	return assetResponse(url.pathname);
};

export const startPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<{ readonly url: string; readonly stop: () => void }> => {
	const manager = options.manager;
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		idleTimeout: 255,
		async fetch(request) {
			try {
				return await gatewayResponse(request, manager);
			} catch (error) {
				return json({ error: String(error) }, { status: 503 });
			}
		},
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot Web Console: ${url}\n`);
	await options.openUrl?.(url);
	return { url, stop: () => server.stop(true) };
};
