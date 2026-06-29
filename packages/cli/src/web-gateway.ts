import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	decodeEventLogRecord,
	type EventLogRecord,
} from "@plot/session/event-log";
import {
	emptyJsonlDecodeState,
	splitJsonl,
	type JsonlDecodeState,
} from "@plot/session/jsonl";
import { openOrStartRunIpc, type RunIpcOptions } from "@plot/session/run-ipc";
import type { RunRecord } from "@plot/session/run-registry";
import {
	emptyProjection,
	rebuildProjectionFromEventLog,
	serializeDashboardProjection,
} from "@plot/session/projection";
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

interface EventLogTailState {
	readonly decoder: TextDecoder;
	readonly jsonl: JsonlDecodeState;
	readonly offset: number;
}

const initialEventLogTailState = (offset = 0): EventLogTailState => ({
	decoder: new TextDecoder(),
	jsonl: emptyJsonlDecodeState,
	offset,
});

const parseEventLogLine = (line: string): EventLogRecord | undefined => {
	try {
		return decodeEventLogRecord(JSON.parse(line) as unknown);
	} catch {
		return undefined;
	}
};

const readEventLogTail = async (input: {
	readonly after: number;
	readonly path: string;
	readonly state: EventLogTailState;
}): Promise<{
	readonly events: readonly EventLogRecord[];
	readonly state: EventLogTailState;
}> => {
	let file;
	try {
		file = await open(input.path, "r");
	} catch {
		return { events: [], state: input.state };
	}
	try {
		const stats = await file.stat();
		let state =
			stats.size < input.state.offset
				? initialEventLogTailState()
				: input.state;
		const events: EventLogRecord[] = [];
		const buffer = Buffer.alloc(64 * 1024);
		while (state.offset < stats.size) {
			// eslint-disable-next-line no-await-in-loop -- tailer reads sequential file offsets.
			const { bytesRead } = await file.read(
				buffer,
				0,
				Math.min(buffer.length, stats.size - state.offset),
				state.offset,
			);
			if (bytesRead <= 0) break;
			const nextOffset = state.offset + bytesRead;
			const chunk = state.decoder.decode(buffer.subarray(0, bytesRead), {
				stream: true,
			});
			const split = splitJsonl(state.jsonl, chunk, {
				maxLineBytes: 2 * 1024 * 1024,
			});
			state = { ...state, jsonl: split.state, offset: nextOffset };
			for (const line of split.lines) {
				const event = parseEventLogLine(line);
				if (event === undefined || Number(event.sequence) <= input.after)
					continue;
				events.push(event);
			}
		}
		return { events, state };
	} finally {
		await file.close();
	}
};

const readRunEventLog = async (
	path: string,
): Promise<readonly EventLogRecord[]> =>
	(
		await readEventLogTail({
			after: -1,
			path,
			state: initialEventLogTailState(),
		})
	).events;

const runEventLogPath = (run: RunRecord): string | undefined => {
	if (run.eventLogPath !== undefined) return run.eventLogPath;
	if (run.sessionId === undefined) return undefined;
	return join(run.cwd, ".plot", "sessions", run.sessionId, "events.jsonl");
};

const runProjectionResponse = async (run: RunRecord): Promise<Response> => {
	const eventLogPath = runEventLogPath(run);
	if (eventLogPath === undefined || run.sessionId === undefined)
		return new Response("run not ready", { status: 409 });
	const projection = rebuildProjectionFromEventLog(
		await readRunEventLog(eventLogPath),
		emptyProjection(run.sessionId, run.workflowName ?? "workflow", {
			cwd: run.cwd,
			cwdName: run.cwdName ?? basename(run.cwd),
			workflowPath: run.workflowPath ?? "WORKFLOW.md",
			skills: [],
			skillPaths: [],
		}),
	);
	return text({ projection: serializeDashboardProjection(projection) });
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
				const projectionPath = /^\/api\/runs\/([^/]+)\/projection$/.exec(
					url.pathname,
				);
				if (projectionPath !== null) {
					const run = await runIpc.runRegistry.status(
						decodeURIComponent(projectionPath[1] ?? ""),
					);
					if (run === undefined)
						return new Response("run not found", { status: 404 });
					return runProjectionResponse(run);
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
