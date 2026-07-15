import { existsSync, unlinkSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	boundaryErrorFromRecord,
	parseBoundaryErrorRecord,
	PlotBoundaryError,
	toBoundaryErrorRecord,
	type BoundaryErrorRecord,
} from "@plot/common/boundary-error";
import { jsonlLines, parseJsonl, stringifyJsonl } from "@plot/common/jsonl";
import { errorMessage, isRecord } from "@plot/common/primitives";
import {
	decodeOperatorObservation,
	decodeRuntimeEvent,
	decodeSourceActionInput,
	type RuntimeEvent,
	type SourceActionStartResult,
} from "@plot/session/runtime";
import { workflowBoundaryErrorFromRecord } from "@plot/session/workflow";
import {
	SessionManager,
	SessionNotControllableError,
	SessionNotFoundError,
	type SessionControlOperation,
	type SessionManagerClient,
	type StartWorkflow,
} from "./manager.js";
import { createFileSessionStore } from "./session-store.js";
import {
	parseSessionSummary,
	type SessionState,
	type SessionSummary,
} from "./session.js";

export const sessionManagerProtocolVersion = 4;

export interface SessionManagerIpcOptions {
	readonly managerDir?: string;
	readonly cli?: { readonly command: string; readonly args: readonly string[] };
	readonly identity?: string;
}

interface SessionManagerIdentity {
	readonly protocol: number;
	readonly build: string;
}

export class SessionManagerIdentityError extends PlotBoundaryError {
	override readonly name = "SessionManagerIdentityError";

	constructor(input: {
		readonly message: string;
		readonly client: SessionManagerIdentity;
		readonly daemon?: SessionManagerIdentity;
	}) {
		const context: Record<string, string | number> = {
			clientProtocol: input.client.protocol,
			clientBuild: input.client.build,
		};
		if (input.daemon !== undefined) {
			context["daemonProtocol"] = input.daemon.protocol;
			context["daemonBuild"] = input.daemon.build;
		}
		super({
			code: "manager_identity_mismatch",
			message: input.message,
			retryable: false,
			context,
		});
	}
}

const protocolHeader = "x-plot-protocol";
const buildHeader = "x-plot-build";
const eventLimits = { maxLineBytes: 2 * 1024 * 1024 } as const;
const directoryMode = 0o700;
const socketMode = 0o600;
const daemonShutdownMs = 45_000;

const identity = (
	options: SessionManagerIpcOptions,
): SessionManagerIdentity => ({
	protocol: sessionManagerProtocolVersion,
	build: options.identity ?? "development",
});

const assertIdentity = (
	client: SessionManagerIdentity,
	options: SessionManagerIpcOptions,
) => {
	const daemon = identity(options);
	if (client.protocol !== daemon.protocol || client.build !== daemon.build)
		throw new SessionManagerIdentityError({
			client,
			daemon,
			message: `Session Manager identity mismatch: client ${client.protocol}/${client.build}, daemon ${daemon.protocol}/${daemon.build}`,
		});
};

const assertRequestIdentity = (
	request: Request,
	options: SessionManagerIpcOptions,
) =>
	assertIdentity(
		{
			protocol: Number(request.headers.get(protocolHeader)),
			build: request.headers.get(buildHeader) ?? "",
		},
		options,
	);

const boundaryError = (error: BoundaryErrorRecord): PlotBoundaryError => {
	if (
		error.code === "manager_identity_mismatch" &&
		typeof error.context?.["clientProtocol"] === "number" &&
		typeof error.context["clientBuild"] === "string"
	) {
		const client = {
			protocol: error.context["clientProtocol"],
			build: error.context["clientBuild"],
		};
		if (
			typeof error.context["daemonProtocol"] === "number" &&
			typeof error.context["daemonBuild"] === "string"
		)
			return new SessionManagerIdentityError({
				message: error.message,
				client,
				daemon: {
					protocol: error.context["daemonProtocol"],
					build: error.context["daemonBuild"],
				},
			});
		return new SessionManagerIdentityError({ message: error.message, client });
	}
	if (
		error.code === "session_not_found" &&
		typeof error.context?.["sessionId"] === "string"
	)
		return new SessionNotFoundError(error.context["sessionId"]);
	if (
		error.code === "session_not_controllable" &&
		typeof error.context?.["sessionId"] === "string" &&
		typeof error.context["state"] === "string" &&
		typeof error.context["operation"] === "string"
	)
		return new SessionNotControllableError({
			sessionId: error.context["sessionId"],
			state: error.context["state"] as SessionState,
			operation: error.context["operation"] as SessionControlOperation,
		});
	const workflow = workflowBoundaryErrorFromRecord(error);
	return workflow ?? boundaryErrorFromRecord(error);
};

const managerDir = (options: SessionManagerIpcOptions): string =>
	resolve(options.managerDir ?? join(homedir(), ".plot", "session-manager"));

export const resolveSessionManagerSocket = (
	options: SessionManagerIpcOptions = {},
): string => join(managerDir(options), "manager.sock");

const createManager = (options: SessionManagerIpcOptions): SessionManager => {
	if (options.cli === undefined)
		throw new Error("Session Manager requires the Plot executable");
	return new SessionManager({
		store: createFileSessionStore(join(managerDir(options), "sessions.json")),
		cli: options.cli,
	});
};

const text = (value: unknown, name: string): string => {
	if (typeof value === "string" && value.length > 0) return value;
	throw new Error(`${name} must be a non-empty string`);
};

const decodeStart = (value: unknown): StartWorkflow => {
	if (!isRecord(value)) throw new Error("start input must be an object");
	const cwd = text(value["cwd"], "cwd");
	const workflowPath = value["workflowPath"];
	if (workflowPath === undefined) return { cwd };
	return { cwd, workflowPath: text(workflowPath, "workflowPath") };
};

const query = (request: Request, name: string): string =>
	text(new URL(request.url).searchParams.get(name), name);

const result = async (operation: Promise<unknown>) =>
	Response.json((await operation) ?? null);

const eventStream = (
	request: Request,
	events: AsyncIterable<RuntimeEvent>,
): Response => {
	const iterator = events[Symbol.asyncIterator]();
	let closed = false;
	const close = () => {
		if (closed) return;
		closed = true;
		request.signal.removeEventListener("abort", close);
		void iterator.return?.();
	};
	request.signal.addEventListener("abort", close, { once: true });
	if (request.signal.aborted) close();
	return new Response(
		new ReadableStream({
			async pull(controller) {
				try {
					const next = await iterator.next();
					if (closed) return;
					if (next.done) {
						close();
						controller.close();
					} else
						controller.enqueue(
							stringifyJsonl({ event: next.value }, eventLimits),
						);
				} catch (error) {
					controller.enqueue(
						stringifyJsonl(
							{
								error: toBoundaryErrorRecord(error, "session-manager-events"),
							},
							eventLimits,
						),
					);
					close();
					controller.close();
				}
			},
			cancel: close,
		}),
		{ headers: { "content-type": "application/x-ndjson" } },
	);
};

const removeStaleSocket = async (path: string) => {
	if (!existsSync(path)) return;
	let live = false;
	try {
		await fetch("http://plot/health", {
			unix: path,
			signal: AbortSignal.timeout(1_000),
		});
		live = true;
	} catch {
		live = false;
	}
	if (live) throw new Error(`Session Manager is already running: ${path}`);
	unlinkSync(path);
};

export const startSessionManagerServer = async (input: {
	readonly options: SessionManagerIpcOptions;
	readonly manager?: SessionManager;
}) => {
	const socketPath = resolveSessionManagerSocket(input.options);
	await mkdir(dirname(socketPath), { recursive: true, mode: directoryMode });
	if (process.platform !== "win32")
		await chmod(dirname(socketPath), directoryMode);
	await removeStaleSocket(socketPath);
	const manager = input.manager ?? createManager(input.options);
	await manager.recoverAfterRestart();
	const secured = <A>(request: Request, work: () => A): A => {
		assertRequestIdentity(request, input.options);
		return work();
	};
	// Bun 1.3.5 honors this for Unix servers but omits it from the type.
	// @ts-expect-error -- event continuations close through request cancellation.
	const server = Bun.serve({
		unix: socketPath,
		idleTimeout: 0,
		routes: {
			"/health": {
				GET: (request) => secured(request, () => Response.json({ ok: true })),
			},
			"/sessions": {
				GET: (request) => secured(request, () => result(manager.list())),
				POST: (request) =>
					secured(request, async () =>
						result(manager.start(decodeStart(await request.json()))),
					),
			},
			"/sessions/find": {
				GET: (request) =>
					secured(request, () =>
						result(manager.find(query(request, "workflowPath"))),
					),
			},
			"/sessions/:sessionId": {
				GET: (request) =>
					secured(request, () => result(manager.get(request.params.sessionId))),
				DELETE: (request) =>
					secured(request, () =>
						result(manager.stopSession(request.params.sessionId)),
					),
			},
			"/workflows": {
				DELETE: (request) =>
					secured(request, () =>
						result(manager.stop(query(request, "workflowPath"))),
					),
			},
			"/sessions/:sessionId/tick": {
				POST: (request) =>
					secured(request, async () => {
						await manager.tick(request.params.sessionId);
						return new Response(null, { status: 204 });
					}),
			},
			"/sessions/:sessionId/observations": {
				POST: (request) =>
					secured(request, async () =>
						result(
							manager.observe(
								request.params.sessionId,
								decodeOperatorObservation(await request.json()),
							),
						),
					),
			},
			"/sessions/:sessionId/source-actions": {
				POST: (request) =>
					secured(request, async () =>
						result(
							manager.startSourceAction(
								request.params.sessionId,
								decodeSourceActionInput(await request.json()),
							),
						),
					),
			},
			"/sessions/:sessionId/source-actions/:actionRunId": {
				DELETE: (request) =>
					secured(request, () =>
						result(
							manager.cancelSourceAction(
								request.params.sessionId,
								request.params.actionRunId,
							),
						),
					),
			},
			"/sessions/:sessionId/events": {
				GET: (request) =>
					secured(request, () => {
						const after = Number(
							new URL(request.url).searchParams.get("after") ?? 0,
						);
						if (!Number.isInteger(after) || after < 0)
							throw new Error("after must be a non-negative integer");
						return eventStream(
							request,
							manager.events(request.params.sessionId, after, request.signal),
						);
					}),
			},
		},
		fetch: () => new Response("not found", { status: 404 }),
		error: (error) =>
			Response.json(
				{ error: toBoundaryErrorRecord(error, "session-manager-http") },
				{ status: 500 },
			),
	});
	if (process.platform !== "win32") await chmod(socketPath, socketMode);
	return {
		manager,
		server,
		socketPath,
		close: () => server.stop(true),
	};
};

const requestHeaders = (options: SessionManagerIpcOptions): Headers => {
	const headers = new Headers({ "content-type": "application/json" });
	const current = identity(options);
	headers.set(protocolHeader, String(current.protocol));
	headers.set(buildHeader, current.build);
	return headers;
};

const managerFetch = (
	options: SessionManagerIpcOptions,
	path: string,
	init: RequestInit = {},
): Promise<Response> =>
	fetch(`http://plot${path}`, {
		...init,
		headers: requestHeaders(options),
		unix: resolveSessionManagerSocket(options),
	});

const responseError = async (response: Response): Promise<never> => {
	const value: unknown = await response.json();
	if (isRecord(value) && value["error"] !== undefined)
		throw boundaryError(parseBoundaryErrorRecord(value["error"]));
	throw new Error(`Session Manager request failed: HTTP ${response.status}`);
};

const requestJson = async (
	options: SessionManagerIpcOptions,
	path: string,
	init?: RequestInit,
): Promise<unknown> => {
	const response = await managerFetch(options, path, init);
	if (!response.ok) return responseError(response);
	if (response.status === 204) return;
	return response.json();
};

const body = (value: unknown): Pick<RequestInit, "body" | "method"> => ({
	method: "POST",
	body: JSON.stringify(value),
});

const pathQuery = (path: string, name: string, value: string): string => {
	const params = new URLSearchParams({ [name]: value });
	return `${path}?${params}`;
};

const sessionValue = (value: unknown): SessionSummary | undefined =>
	value === null || value === undefined
		? undefined
		: parseSessionSummary(value);

export const createSessionManagerClient = (
	options: SessionManagerIpcOptions = {},
): SessionManagerClient => ({
	start: async (input) => {
		const value = await requestJson(options, "/sessions", body(input));
		if (!isRecord(value)) throw new Error("Invalid start response");
		return {
			session: parseSessionSummary(value["session"]),
			started: value["started"] === true,
		};
	},
	find: async (workflowPath) =>
		sessionValue(
			await requestJson(
				options,
				pathQuery("/sessions/find", "workflowPath", workflowPath),
			),
		),
	get: async (sessionId) =>
		sessionValue(
			await requestJson(options, `/sessions/${encodeURIComponent(sessionId)}`),
		),
	stop: async (workflowPath) =>
		sessionValue(
			await requestJson(
				options,
				pathQuery("/workflows", "workflowPath", workflowPath),
				{ method: "DELETE" },
			),
		),
	stopSession: async (sessionId) =>
		sessionValue(
			await requestJson(options, `/sessions/${encodeURIComponent(sessionId)}`, {
				method: "DELETE",
			}),
		),
	list: async () => {
		const value = await requestJson(options, "/sessions");
		if (!Array.isArray(value)) throw new Error("Invalid Session list");
		return value.map(parseSessionSummary);
	},
	events: (sessionId, after = 0, signal) => ({
		async *[Symbol.asyncIterator]() {
			if (signal?.aborted) return;
			try {
				const init: RequestInit = {};
				if (signal !== undefined) init.signal = signal;
				const response = await managerFetch(
					options,
					`/sessions/${encodeURIComponent(sessionId)}/events?after=${after}`,
					init,
				);
				if (!response.ok) return responseError(response);
				if (response.body === null) return;
				for await (const line of jsonlLines(response.body, eventLimits)) {
					if (line.trim() === "") continue;
					const value = parseJsonl(line);
					if (!isRecord(value)) throw new Error("Invalid event stream record");
					if (value["error"] !== undefined)
						throw boundaryError(parseBoundaryErrorRecord(value["error"]));
					yield decodeRuntimeEvent(value["event"]);
				}
			} catch (error) {
				if (!signal?.aborted) throw error;
			}
		},
	}),
	tick: async (sessionId) => {
		await requestJson(
			options,
			`/sessions/${encodeURIComponent(sessionId)}/tick`,
			{ method: "POST" },
		);
	},
	observe: async (sessionId, input) =>
		(await requestJson(
			options,
			`/sessions/${encodeURIComponent(sessionId)}/observations`,
			body(input),
		)) === true,
	startSourceAction: async (sessionId, input) =>
		(await requestJson(
			options,
			`/sessions/${encodeURIComponent(sessionId)}/source-actions`,
			body(input),
		)) as SourceActionStartResult,
	cancelSourceAction: async (sessionId, actionRunId) =>
		(await requestJson(
			options,
			`/sessions/${encodeURIComponent(sessionId)}/source-actions/${encodeURIComponent(actionRunId)}`,
			{ method: "DELETE" },
		)) === true,
});

const sleep = (ms: number) =>
	new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const waitForManager = async (
	options: SessionManagerIpcOptions,
	timeoutMs = 5_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() <= deadline) {
		try {
			await requestJson(options, "/health");
			return;
		} catch (error) {
			if (error instanceof SessionManagerIdentityError) throw error;
			lastError = error;
			await sleep(50);
		}
	}
	throw new Error(`Session Manager did not start: ${errorMessage(lastError)}`);
};

const startManagerDaemon = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	if (options.cli === undefined) throw new Error("Plot executable is required");
	const args = [...options.cli.args, "__internal-session-manager"];
	if (options.managerDir !== undefined)
		args.push("--manager-dir", options.managerDir);
	const child = Bun.spawn([options.cli.command, ...args], {
		detached: true,
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	child.unref();
	const failed = child.exited.then((code) => {
		throw new Error(`Session Manager exited before ready: ${code}`);
	});
	try {
		await Promise.race([waitForManager(options), failed]);
	} catch (error) {
		try {
			await waitForManager(options, 1_000);
		} catch {
			throw error;
		}
	}
};

export const openSessionManager = async (
	options: SessionManagerIpcOptions,
): Promise<SessionManagerClient> => {
	try {
		await requestJson(options, "/health");
	} catch (error) {
		if (error instanceof SessionManagerIdentityError) throw error;
		await startManagerDaemon(options);
	}
	return createSessionManagerClient(options);
};

export const runSessionManagerDaemon = async (
	options: SessionManagerIpcOptions,
): Promise<void> => {
	const started = await startSessionManagerServer({ options });
	await new Promise<void>((resolveSignal) => {
		process.once("SIGINT", resolveSignal);
		process.once("SIGTERM", resolveSignal);
	});
	const shutdown = (async () => {
		const closing = started.close();
		await started.manager.shutdown();
		await closing;
	})();
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			shutdown,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error("Session Manager shutdown timed out")),
					daemonShutdownMs,
				);
			}),
		]);
	} catch (error) {
		started.manager.forceClose();
		throw error;
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
		if (existsSync(started.socketPath)) unlinkSync(started.socketPath);
	}
};
