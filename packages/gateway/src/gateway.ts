import { basename } from "node:path";
import { isRecord } from "@plot/common/primitives";
import {
	emptyProjection,
	reduceProjectableEvent,
	serializeDashboardProjection,
	type DashboardProjection,
} from "@plot/projection";
import type {
	SessionManagerClient,
	StartWorkflow,
} from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import { readSessionEvents } from "@plot/session/history";
import {
	decodeOperatorObservation,
	decodeSourceActionInput,
	type OperatorObservationInput,
	type RuntimeEvent,
} from "@plot/session/runtime";
import { readAgentTranscript } from "@plot/session/transcript";
import { webAssets, type WebAsset } from "./web-assets.generated.js";

const assets: Readonly<Record<string, WebAsset>> = webAssets;

export interface GatewayHandle {
	readonly url: string;
	readonly stop: () => void;
}

export interface GatewayOptions {
	readonly host?: string;
	readonly port?: number;
	readonly writeStderr?: (text: string) => Promise<void> | void;
	readonly openUrl?: (url: string) => Promise<void> | void;
	readonly manager: SessionManagerClient;
}

const errorResponse = (error: string, status: number): Response =>
	Response.json({ error }, { status });

const assetResponse = (pathname: string): Response => {
	if (pathname === "/favicon.ico") return new Response(null, { status: 204 });
	const asset = assets[pathname === "/" ? "/index.html" : pathname];
	if (asset === undefined) return new Response("not found", { status: 404 });
	return new Response(Buffer.from(asset.bodyBase64, "base64"), {
		headers: { "content-type": asset.contentType },
	});
};

const parseBody = async <A>(
	request: Request,
	decode: (value: unknown) => A | undefined,
): Promise<A | undefined> => {
	try {
		return decode(await request.json());
	} catch {
		return;
	}
};

const nonEmptyString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value : undefined;

const parseStart = (request: Request): Promise<StartWorkflow | undefined> =>
	parseBody(request, (value) => {
		if (!isRecord(value)) return;
		const cwd = nonEmptyString(value["cwd"]);
		if (cwd === undefined) return;
		const workflowPath = nonEmptyString(value["workflowPath"]);
		return workflowPath === undefined ? { cwd } : { cwd, workflowPath };
	});

const parseObservation = async (
	request: Request,
): Promise<OperatorObservationInput | undefined> => {
	const input = await parseBody(request, decodeOperatorObservation);
	return input === undefined ? undefined : { ...input, actor: "web" };
};

const parseSequence = (value: string | null): number | undefined => {
	if (value === null) return;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

const parseAfter = (request: Request): number | undefined => {
	const headerValue = request.headers.get("last-event-id");
	const queryValue = new URL(request.url).searchParams.get("after");
	const header = parseSequence(headerValue);
	const query = parseSequence(queryValue);
	if (headerValue !== null && header === undefined) return;
	if (queryValue !== null && query === undefined) return;
	return Math.max(header ?? 0, query ?? 0);
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
	manager: SessionManagerClient,
	id: string,
	handle: (session: SessionSummary) => Promise<Response> | Response,
): Promise<Response> => {
	const session = await manager.get(id);
	return session === undefined
		? new Response("Session not found", { status: 404 })
		: handle(session);
};

const sseFrame = (event: RuntimeEvent): string =>
	`id: ${event.sequence}\nevent: plot\ndata: ${JSON.stringify({ kind: "event", event })}\n\n`;

const eventsResponse = (input: {
	readonly request: Request;
	readonly events: (signal: AbortSignal) => AsyncIterable<RuntimeEvent>;
}): Response => {
	const encoder = new TextEncoder();
	const eventController = new AbortController();
	const iterator = input.events(eventController.signal)[Symbol.asyncIterator]();
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		input.request.signal.removeEventListener("abort", close);
		eventController.abort();
		void iterator.return?.();
	};
	input.request.signal.addEventListener("abort", close, { once: true });
	if (input.request.signal.aborted) close();
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controller) {
				if (closed) controller.close();
				else controller.enqueue(encoder.encode(": connected\n\n"));
			},
			async pull(controller) {
				try {
					const next = await iterator.next();
					if (closed) return;
					if (next.done) {
						close();
						controller.close();
					} else controller.enqueue(encoder.encode(sseFrame(next.value)));
				} catch (error) {
					close();
					controller.error(error);
				}
			},
			cancel: close,
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

const sessionTranscriptResponse = async (
	session: SessionSummary,
	attemptRunId: string,
): Promise<Response> => {
	const projection = await replayProjection(session);
	const path = projection.attempts.get(attemptRunId)?.transcript?.path;
	if (path === undefined)
		return new Response("no transcript recorded", { status: 404 });
	return Response.json({ entries: await readAgentTranscript(path) });
};

export const startWebGateway = async (
	options: GatewayOptions,
): Promise<GatewayHandle> => {
	const manager = options.manager;
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		// SSE closes through request cancellation, not idle time.
		idleTimeout: 0,
		routes: {
			"/api/health": {
				GET: () => Response.json({ ok: true }),
			},
			"/api/sessions": {
				GET: async () => Response.json({ sessions: await manager.list() }),
				POST: async (request) => {
					const input = await parseStart(request);
					return input === undefined
						? errorResponse("invalid Session body", 400)
						: Response.json(await manager.start(input));
				},
			},
			"/api/sessions/:sessionId": {
				DELETE: async (request) => {
					const session = await manager.stopSession(request.params.sessionId);
					return session === undefined
						? new Response("Session not found", { status: 404 })
						: Response.json({ session });
				},
			},
			"/api/sessions/:sessionId/projection": {
				GET: (request) =>
					withSession(manager, request.params.sessionId, async (session) =>
						Response.json({
							projection: serializeDashboardProjection(
								await replayProjection(session),
							),
						}),
					),
			},
			"/api/sessions/:sessionId/events": {
				GET: (request) => {
					const after = parseAfter(request);
					if (after === undefined)
						return errorResponse("invalid after sequence", 400);
					return withSession(manager, request.params.sessionId, () =>
						eventsResponse({
							request,
							events: (signal) =>
								manager.events(request.params.sessionId, after, signal),
						}),
					);
				},
			},
			"/api/sessions/:sessionId/observations": {
				POST: async (request) => {
					const input = await parseObservation(request);
					return input === undefined
						? errorResponse("invalid observation", 400)
						: Response.json({
								accepted: await manager.observe(
									request.params.sessionId,
									input,
								),
							});
				},
			},
			"/api/sessions/:sessionId/source-actions": {
				POST: async (request) => {
					const input = await parseBody(request, decodeSourceActionInput);
					return input === undefined
						? errorResponse("invalid Source action", 400)
						: Response.json(
								await manager.startSourceAction(
									request.params.sessionId,
									input,
								),
							);
				},
			},
			"/api/sessions/:sessionId/source-actions/:actionRunId": {
				DELETE: async (request) =>
					Response.json({
						accepted: await manager.cancelSourceAction(
							request.params.sessionId,
							request.params.actionRunId,
						),
					}),
			},
			"/api/sessions/:sessionId/attempts/:attemptRunId/transcript": {
				GET: (request) =>
					withSession(manager, request.params.sessionId, (session) =>
						sessionTranscriptResponse(session, request.params.attemptRunId),
					),
			},
		},
		fetch(request) {
			const pathname = new URL(request.url).pathname;
			if (pathname.startsWith("/api/"))
				return errorResponse("API route not found", 404);
			if (request.method !== "GET" && request.method !== "HEAD")
				return new Response("not found", { status: 404 });
			return assetResponse(pathname);
		},
		error: (error) => errorResponse(String(error), 503),
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot Web Console: ${url}\n`);
	await options.openUrl?.(url);
	return {
		url,
		stop: () => {
			void server.stop(true);
		},
	};
};
