import { spawn } from "node:child_process";
import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { SessionHistoryEvent } from "@plot/session/protocol";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import { connectLocalControlClient } from "@plot/session/local-control-client";
import { ensureLocalControlToken } from "@plot/session/local-server-auth";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import {
	awaitShutdownSignal,
	runLocalPlotServer,
	startLocalPlotServer,
	type LocalPlotServerHandle,
} from "@plot/session/local-server";
import {
	runPlotSessionHostDaemon,
	runPlotSessionHostOnce,
	runPlotSessionHostStdio,
} from "@plot/session/session-host";
import { resolveWorkflowPath } from "@plot/session/workflow";
import { loadPlotWebAssets, tryLoadPlotWebAssets } from "./web-assets.js";

export type LogFormat = "json" | "logfmt" | "pretty";
export type LogLevelFlag =
	| "trace"
	| "debug"
	| "info"
	| "warn"
	| "error"
	| "fatal"
	| "none";
interface BaseRunOptions {
	readonly workflowPath?: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
	readonly logLevel: LogLevelFlag;
	readonly logFormat: LogFormat;
	readonly homeDir?: string;
	readonly serverDir?: string;
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly replayCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly agentSessionOverrides?: PlotAgentSessionCliOverrides;
	readonly createAgentSession?: CreateAgentSession;
}
export interface ServeStdioOptions extends BaseRunOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface ServeLocalOptions extends BaseRunOptions {
	readonly hostname?: string;
	readonly port?: number;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface RunWebDashboardOptions extends BaseRunOptions {
	readonly hostname?: string;
	readonly port?: number;
	readonly selectedSessionId?: string;
	readonly role?: "observer" | "controller";
	readonly explicitFleet?: boolean;
	readonly noOpen?: boolean;
	readonly writeStdout: (line: string) => Promise<void> | void;
	readonly openBrowser?: (url: string) => Promise<void> | void;
}
export interface StartedWebDashboard {
	readonly url: string;
	readonly server: LocalPlotServerHandle;
	readonly stop: () => Promise<void>;
}
export interface RunDaemonOptions extends BaseRunOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Promise<void> | void;
}
export interface RunInProcessOnceOptions extends BaseRunOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Promise<void> | void;
}
export interface RunControlOneshotOptions extends BaseRunOptions {
	readonly onEvent?: (event: SessionHistoryEvent) => Promise<void> | void;
}
const toLogLevel = (
	level: LogLevelFlag,
): "Debug" | "Info" | "Warning" | "Error" =>
	level === "debug" || level === "trace"
		? "Debug"
		: level === "error" || level === "fatal"
			? "Error"
			: level === "warn"
				? "Warning"
				: "Info";
const workflowPathLogField = (options: BaseRunOptions) =>
	resolveWorkflowPath({
		cwd: options.cwd,
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: options.workflowPath }),
	});
const openSessionParamsFrom = (
	options: BaseRunOptions,
	mode: "watch" | "oneshot",
) => ({
	sessionId: options.sessionId,
	mode,
	role: "controller" as const,
	cwd: options.cwd,
	...(options.workflowPath === undefined
		? {}
		: { workflowPath: options.workflowPath }),
	...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
	...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
	...(options.sessionDir === undefined
		? {}
		: { sessionDir: options.sessionDir }),
	...(options.requestQueueCapacity === undefined
		? {}
		: { requestQueueCapacity: options.requestQueueCapacity }),
	...(options.eventCapacity === undefined
		? {}
		: { eventCapacity: options.eventCapacity }),
	...(options.replayCapacity === undefined
		? {}
		: { replayCapacity: options.replayCapacity }),
	...(options.tickIntervalMs === undefined
		? {}
		: { tickIntervalMs: options.tickIntervalMs }),
	...(options.maxRunDurationMs === undefined
		? {}
		: { maxRunDurationMs: options.maxRunDurationMs }),
	...(options.agentSessionOverrides === undefined
		? {}
		: { agentSessionOverrides: options.agentSessionOverrides }),
});
const terminalRecordFor = (sessionId: string, record: unknown): boolean => {
	if (typeof record !== "object" || record === null) return false;
	const r = record as {
		readonly kind?: string;
		readonly sessionId?: string;
		readonly event?: { readonly type?: string };
		readonly session?: { readonly id?: string; readonly state?: string };
	};
	return (
		(r.kind === "session_event" &&
			r.sessionId === sessionId &&
			r.event?.type === "session_shutdown") ||
		(r.kind === "roster_event" &&
			r.session?.id === sessionId &&
			(r.session.state === "stopped" || r.session.state === "error"))
	);
};
const provideCliLogger = async <A>(
	options: BaseRunOptions,
	work: () => Promise<A> | A,
): Promise<A> => {
	LoggerLive({ level: toLogLevel(options.logLevel), stderr: true });
	return work();
};

const webSocketUrl = (serverUrl: string, token: string): string => {
	const url = new URL("/ws", serverUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("token", token);
	return url.toString();
};

const webDashboardUrl = (input: {
	readonly serverUrl: string;
	readonly token: string;
	readonly sessionId?: string;
	readonly role?: "observer" | "controller";
	readonly explicitFleet?: boolean;
}): string => {
	const url = new URL("/", input.serverUrl);
	const hash = new URLSearchParams();
	hash.set("ws", webSocketUrl(input.serverUrl, input.token));
	if (input.sessionId !== undefined) hash.set("session", input.sessionId);
	if (input.role === "observer") hash.set("role", "observer");
	if (input.explicitFleet) hash.set("view", "fleet");
	url.hash = hash.toString();
	return url.toString();
};

const openBrowserDefault = async (url: string): Promise<void> => {
	const command =
		process.platform === "darwin"
			? "open"
			: process.platform === "win32"
				? "cmd"
				: "xdg-open";
	const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
};
export const runDaemon = (options: RunDaemonOptions): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run_no_server",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			() => runPlotSessionHostDaemon(options),
		),
	);

export const runInProcessOnce = (
	options: RunInProcessOnceOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run_no_server_once",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			async () => {
				await runPlotSessionHostOnce(options);
			},
		),
	);

export const runControlOneshot = (
	options: RunControlOneshotOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run_control_oneshot",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			async () => {
				const client = await connectLocalControlClient({
					cwd: options.cwd,
					...(options.homeDir === undefined
						? {}
						: { homeDir: options.homeDir }),
					...(options.serverDir === undefined
						? {}
						: { serverDir: options.serverDir }),
				});
				try {
					await client.openSession(openSessionParamsFrom(options, "oneshot"));
					await client.attachSession({
						sessionId: options.sessionId,
						role: "controller",
						afterSequence: 0,
					});
					for await (const record of client.records()) {
						if (
							record.kind === "session_event" &&
							record.sessionId === options.sessionId
						)
							await options.onEvent?.(record.event);
						if (terminalRecordFor(options.sessionId, record)) break;
					}
				} finally {
					await client
						.detachSession({ sessionId: options.sessionId })
						.catch(() => undefined);
					client.close();
				}
			},
		),
	);
export const serveStdio = (options: ServeStdioOptions): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.serve_stdio",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			() => runPlotSessionHostStdio(options),
		),
	);

export const serveLocal = (options: ServeLocalOptions): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.serve_local",
			{
				hostname: options.hostname ?? "localhost",
				port: options.port ?? 3927,
			},
			async () => {
				const webAssets = await tryLoadPlotWebAssets();
				return runLocalPlotServer({
					cwd: options.cwd,
					...(options.hostname === undefined
						? {}
						: { hostname: options.hostname }),
					...(options.port === undefined ? {} : { port: options.port }),
					...(webAssets === undefined ? {} : { webAssets }),
					reuseExisting: false,
					print: options.writeStdout,
				});
			},
		),
	);

export const startWebDashboard = async (
	options: RunWebDashboardOptions,
): Promise<StartedWebDashboard> => {
	const webAssets = await loadPlotWebAssets();
	const server = await startLocalPlotServer({
		cwd: options.cwd,
		...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
		...(options.serverDir === undefined
			? {}
			: { serverDir: options.serverDir }),
		...(options.hostname === undefined ? {} : { hostname: options.hostname }),
		...(options.port === undefined ? {} : { port: options.port }),
		webAssets,
		// Reuse a Local Plot Server that is already running (e.g. one a TUI
		// autostarted) so the web attaches to the shared fleet instead of starting
		// a competing server. Only starts one when none exists yet.
		reuseExisting: true,
	});
	const token = await ensureLocalControlToken(server.paths);
	const url = webDashboardUrl({
		serverUrl: server.url,
		token: token.token,
		...(options.selectedSessionId === undefined
			? {}
			: { sessionId: options.selectedSessionId }),
		...(options.role === undefined ? {} : { role: options.role }),
		...(options.explicitFleet === undefined
			? {}
			: { explicitFleet: options.explicitFleet }),
	});
	await options.writeStdout(
		`${JSON.stringify({ event: "plot_web_url", url, opened: !options.noOpen })}\n`,
	);
	if (!options.noOpen) {
		try {
			await (options.openBrowser ?? openBrowserDefault)(url);
		} catch {
			// The URL is already printed; keep the foreground server alive so the
			// operator can paste it manually instead of silently daemonizing or exiting.
		}
	}
	return { url, server, stop: server.stop };
};

export const runWebDashboard = (
	options: RunWebDashboardOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.web",
			{
				session_id: options.selectedSessionId ?? "fleet",
				role: options.role ?? "controller",
			},
			async () => {
				// Hold the foreground until Ctrl-C, then run the server's cleanup
				// (close sessions, remove metadata, drop the socket) before exiting —
				// rather than leaving the process to be hard-killed.
				const dashboard = await startWebDashboard(options);
				try {
					await awaitShutdownSignal();
				} finally {
					await dashboard.stop();
				}
			},
		),
	);
