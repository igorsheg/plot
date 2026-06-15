import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { SessionHistoryEvent } from "@plot/session/protocol";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import { connectLocalControlClient } from "@plot/session/local-control-client";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import { runLocalPlotServer } from "@plot/session/local-server";
import {
	runPlotSessionHostDaemon,
	runPlotSessionHostOnce,
	runPlotSessionHostStdio,
} from "@plot/session/session-host";
import { resolveWorkflowPath } from "@plot/session/workflow";

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
			() =>
				runLocalPlotServer({
					cwd: options.cwd,
					...(options.hostname === undefined
						? {}
						: { hostname: options.hostname }),
					...(options.port === undefined ? {} : { port: options.port }),
					print: options.writeStdout,
				}),
		),
	);
