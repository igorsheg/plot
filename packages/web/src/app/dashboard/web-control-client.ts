import {
	plotProtocolRequestId,
	plotProtocolVersion,
	safeParsePlotServerRecord,
	type PlotClientRecord,
	type PlotCommand,
	type PlotProtocolRequestId,
	type PlotServerRecord,
	type PlotSuccessResponseRecord,
	type PlotWelcomeRecord,
} from "@plot/control/protocol";
import {
	plotSessionSummarySchema,
	type PlotSessionSummary,
} from "@plot/control/session-summary";

export interface BrowserControlHandoff {
	readonly wsUrl: string;
}

export interface BrowserPlotControlClient {
	readonly welcome: PlotWelcomeRecord;
	readonly request: (
		command: PlotCommand,
		params?: unknown,
	) => Promise<PlotSuccessResponseRecord>;
	readonly listSessions: () => Promise<readonly PlotSessionSummary[]>;
	readonly attachSession: (params: {
		readonly sessionId: string;
		readonly afterSequence?: number;
		readonly role?: "observer" | "controller";
	}) => Promise<{
		readonly response: PlotSuccessResponseRecord;
		readonly snapshot: unknown;
		readonly lastSequence: number;
	}>;
	readonly onRecord: (
		handler: (record: PlotServerRecord) => void,
	) => () => void;
	readonly close: () => void;
}

const storageKey = "plot.localControl.wsUrl";

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const paramsFrom = (location: Location): URLSearchParams => {
	const params = new URLSearchParams(location.search);
	const hash = location.hash.startsWith("#")
		? location.hash.slice(1)
		: location.hash;
	const hashParams = new URLSearchParams(hash);
	for (const [key, value] of hashParams) params.set(key, value);
	return params;
};

const wsUrlFrom = (params: URLSearchParams) => {
	const direct = params.get("ws") ?? params.get("wsUrl");
	if (direct !== null && direct !== "") return direct;
	const server = params.get("server") ?? params.get("url");
	const token = params.get("token");
	if (server === null || server === "" || token === null || token === "")
		return undefined;
	const url = new URL("/ws", server);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("token", token);
	return url.toString();
};

const safeSessionStorage = (): Storage | undefined => {
	try {
		return globalThis.sessionStorage;
	} catch {
		return undefined;
	}
};

export const readBrowserControlHandoff = (
	location: Location,
	storage: Storage | undefined = safeSessionStorage(),
): BrowserControlHandoff | undefined => {
	const params = paramsFrom(location);
	const wsUrl = wsUrlFrom(params) ?? storage?.getItem(storageKey) ?? undefined;
	if (wsUrl === undefined || wsUrl === "") return undefined;
	storage?.setItem(storageKey, wsUrl);
	if (params.has("token") || params.has("ws") || params.has("wsUrl")) {
		const cleanSearch = new URLSearchParams(location.search);
		cleanSearch.delete("token");
		cleanSearch.delete("ws");
		cleanSearch.delete("wsUrl");
		const cleanHash = new URLSearchParams(location.hash.slice(1));
		cleanHash.delete("token");
		cleanHash.delete("ws");
		cleanHash.delete("wsUrl");
		const search = cleanSearch.size === 0 ? "" : `?${cleanSearch.toString()}`;
		const hash = cleanHash.size === 0 ? "" : `#${cleanHash.toString()}`;
		globalThis.history?.replaceState(
			null,
			"",
			`${location.pathname}${search}${hash}`,
		);
	}
	return { wsUrl };
};

const waitForOpen = (ws: WebSocket): Promise<void> =>
	new Promise((resolve, reject) => {
		ws.addEventListener("open", () => resolve(), { once: true });
		ws.addEventListener("error", () => reject(new Error("websocket failed")), {
			once: true,
		});
	});

const dataObject = (record: PlotSuccessResponseRecord) =>
	typeof record.data === "object" && record.data !== null
		? (record.data as Record<string, unknown>)
		: {};

const sessionsFrom = (value: unknown): readonly PlotSessionSummary[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const parsed = plotSessionSummarySchema.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
};

export const connectBrowserPlotControl = async (
	handoff: BrowserControlHandoff,
): Promise<BrowserPlotControlClient> => {
	const ws = new WebSocket(handoff.wsUrl);
	const handlers = new Set<(record: PlotServerRecord) => void>();
	const pending = new Map<
		PlotProtocolRequestId,
		{
			readonly resolve: (record: PlotSuccessResponseRecord) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	let welcome: PlotWelcomeRecord | undefined;
	let requestIndex = 0;
	const welcomePromise = new Promise<PlotWelcomeRecord>((resolve, reject) => {
		ws.addEventListener(
			"message",
			(event) => {
				try {
					const parsed = safeParsePlotServerRecord(
						JSON.parse(String(event.data)) as unknown,
					);
					if (!parsed.success) throw new Error(parsed.error.message);
					if (parsed.data.kind !== "welcome")
						throw new Error(`expected welcome, received ${parsed.data.kind}`);
					welcome = parsed.data;
					resolve(parsed.data);
				} catch (error) {
					reject(new Error(errorMessage(error)));
				}
			},
			{ once: true },
		);
	});
	ws.addEventListener("message", (event) => {
		try {
			const parsed = safeParsePlotServerRecord(
				JSON.parse(String(event.data)) as unknown,
			);
			if (!parsed.success) throw new Error(parsed.error.message);
			const record = parsed.data;
			if (record.kind === "welcome" && welcome === undefined) welcome = record;
			if (record.kind === "response" && record.id !== undefined) {
				const waiter = pending.get(record.id);
				if (waiter !== undefined) {
					pending.delete(record.id);
					if (record.ok) waiter.resolve(record);
					else
						waiter.reject(
							new Error(`${record.error.code}: ${record.error.message}`),
						);
				}
			}
			for (const handler of handlers) handler(record);
		} catch (error) {
			for (const waiter of pending.values())
				waiter.reject(new Error(errorMessage(error)));
			pending.clear();
		}
	});
	ws.addEventListener("close", () => {
		for (const waiter of pending.values())
			waiter.reject(new Error("Local Plot Server connection closed"));
		pending.clear();
	});
	await waitForOpen(ws);
	const firstWelcome = await welcomePromise;
	const request = (command: PlotCommand, params?: unknown) => {
		const id = plotProtocolRequestId(`web-${++requestIndex}`);
		const record: PlotClientRecord = {
			protocol: plotProtocolVersion,
			kind: "request",
			id,
			command,
			...(params === undefined ? {} : { params }),
		};
		return new Promise<PlotSuccessResponseRecord>((resolve, reject) => {
			pending.set(id, { resolve, reject });
			ws.send(JSON.stringify(record));
		});
	};
	return {
		welcome: firstWelcome,
		request,
		listSessions: async () => {
			const response = await request("list_sessions", {});
			return sessionsFrom(dataObject(response)["sessions"]);
		},
		attachSession: async (params) => {
			const response = await request("attach_session", {
				sessionId: params.sessionId,
				role: params.role ?? "observer",
				...(params.afterSequence === undefined
					? {}
					: { afterSequence: params.afterSequence }),
			});
			const data = dataObject(response);
			const lastSequence =
				typeof data["lastSequence"] === "number" ? data["lastSequence"] : 0;
			return { response, snapshot: data["snapshot"], lastSequence };
		},
		onRecord: (handler) => {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		close: () => ws.close(),
	};
};
