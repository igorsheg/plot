import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import {
	safeParseEventLogEvent,
	type EventLogEvent,
} from "@plot/session/protocol";
import {
	initialJsonlDecoderState,
	splitJsonlChunk,
	type JsonlDecoderState,
} from "@plot/session/protocol-jsonl";
import { startPlotSupervisorIpcServer } from "@plot/session/supervisor-ipc";
import {
	resolvePlotCliSpawnCommand,
	type PlotInstanceRecord,
} from "@plot/session/supervisor";
import {
	emptyProjection,
	rebuildProjectionFromEventLog,
	type DashboardProjection,
} from "@plot/tui/projection";
import { webAssets, type WebAsset } from "./web-assets.generated.js";

const assets: Record<string, WebAsset> = webAssets;

export interface PlotWebGatewayOptions {
	readonly cwd: string;
	readonly agentDir?: string | undefined;
	readonly workflowPath?: string | undefined;
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

const sseFrame = (event: unknown, id?: number): string =>
	`${id === undefined ? "" : `id: ${id}\n`}event: plot\ndata: ${JSON.stringify(event)}\n\n`;

const parseSequence = (value: string | null): number | undefined => {
	if (value === null) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
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
	readonly jsonl: JsonlDecoderState;
	readonly offset: number;
}

const initialEventLogTailState = (offset = 0): EventLogTailState => ({
	decoder: new TextDecoder(),
	jsonl: initialJsonlDecoderState,
	offset,
});

const parseEventLogLine = (line: string): EventLogEvent | undefined => {
	try {
		const parsed = safeParseEventLogEvent(JSON.parse(line) as unknown);
		return parsed.success ? (parsed.data as EventLogEvent) : undefined;
	} catch {
		return undefined;
	}
};

const readEventLogTail = async (input: {
	readonly after: number;
	readonly path: string;
	readonly state: EventLogTailState;
}): Promise<{
	readonly events: readonly EventLogEvent[];
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
		const events: EventLogEvent[] = [];
		const buffer = Buffer.alloc(64 * 1024);
		while (state.offset < stats.size) {
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
			const split = await splitJsonlChunk(state.jsonl, chunk);
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

const readSessionEventLog = async (
	path: string,
): Promise<readonly EventLogEvent[]> =>
	(
		await readEventLogTail({
			after: -1,
			path,
			state: initialEventLogTailState(),
		})
	).events;

const serializableProjection = (projection: DashboardProjection) => ({
	...projection,
	work: Object.fromEntries(projection.work),
	attempts: Object.fromEntries(projection.attempts),
});

const sessionProjectionResponse = async (
	instance: PlotInstanceRecord,
): Promise<Response> => {
	if (instance.eventLogPath === undefined || instance.sessionId === undefined)
		return new Response("session not ready", { status: 409 });
	const projection = rebuildProjectionFromEventLog(
		await readSessionEventLog(instance.eventLogPath),
		emptyProjection(instance.sessionId, instance.workflowName ?? "workflow", {
			cwd: instance.cwd,
			cwdName: instance.cwdName ?? instance.cwd,
			workflowPath: instance.workflowPath ?? "WORKFLOW.md",
			skills: [],
			skillPaths: [],
		}),
	);
	return text({ projection: serializableProjection(projection) });
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
	const supervisor = await startPlotSupervisorIpcServer({
		options: {
			cwd: options.cwd,
			...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
			cli: resolvePlotCliSpawnCommand(),
		},
	});
	const server = Bun.serve({
		hostname: options.host ?? "127.0.0.1",
		port: options.port ?? 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === "/api/instances" && request.method === "POST") {
				const instance = await supervisor.supervisor.spawnInstance({
					cwd: options.cwd,
					...(options.workflowPath === undefined
						? {}
						: { workflowPath: options.workflowPath }),
					...(options.agentDir === undefined
						? {}
						: { agentDir: options.agentDir }),
				});
				return text({ instance });
			}
			const stopPath = /^\/api\/instances\/([^/]+)$/.exec(url.pathname);
			if (stopPath !== null && request.method === "DELETE") {
				const instance = await supervisor.supervisor.stopInstance(
					decodeURIComponent(stopPath[1] ?? ""),
				);
				return instance === undefined
					? new Response("instance not found", { status: 404 })
					: text({ instance });
			}
			if (url.pathname === "/api/instances") {
				return text({ instances: supervisor.supervisor.listInstances() });
			}
			const eventPath = /^\/api\/instances\/([^/]+)\/events$/.exec(
				url.pathname,
			);
			if (eventPath !== null) {
				const after = parseAfterSequence({
					header: request.headers.get("last-event-id"),
					query: url.searchParams.get("after"),
				});
				if (after === undefined)
					return text({ error: "invalid after sequence" });
				const id = decodeURIComponent(eventPath[1] ?? "");
				const instance = supervisor.supervisor.getInstance(id);
				if (instance === undefined)
					return new Response("session not found", { status: 404 });
				if (instance.eventLogPath === undefined)
					return new Response("session not ready", { status: 409 });
				void instance;
				return sessionEventsResponse({
					request,
					records: supervisor.supervisor.attachRecords(id, after),
				});
			}
			const projectionPath = /^\/api\/instances\/([^/]+)\/projection$/.exec(
				url.pathname,
			);
			if (projectionPath !== null) {
				const instance = supervisor.supervisor.getInstance(
					decodeURIComponent(projectionPath[1] ?? ""),
				);
				if (instance === undefined)
					return new Response("session not found", { status: 404 });
				return sessionProjectionResponse(instance);
			}
			if (url.pathname === "/api/health")
				return text({ ok: true, socketPath: supervisor.socketPath });
			return assetResponse(url.pathname);
		},
	});
	const url = `http://${server.hostname}:${server.port}/`;
	await options.writeStderr?.(`Plot web: ${url}\n`);
	if (options.open !== false) await (options.openUrl ?? openBrowser)(url);
	return {
		url,
		stop: () => {
			server.stop(true);
			supervisor.server.close();
			void supervisor.supervisor.shutdown();
		},
	};
};

export const runPlotWebGateway = async (
	options: PlotWebGatewayOptions,
): Promise<void> => {
	await startPlotWebGateway(options);
	await new Promise<void>(() => {});
};
