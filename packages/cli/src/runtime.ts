import { existsSync, unlinkSync } from "node:fs";
import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { EventLogEvent } from "@plot/session/protocol";
import type {
	CreateAgentSession,
	PlotAgentSessionCliOverrides,
} from "@plot/session/pi/agent-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import {
	runPlotSessionHostOnce,
	runPlotSessionHostStdio,
} from "@plot/session/session-host";
import { resolvePlotCliSpawnCommand } from "@plot/session/supervisor";
import { startPlotSupervisorIpcServer } from "@plot/session/supervisor-ipc";
import { resolveWorkflowPath } from "@plot/session/workflow";
import { errorMessage } from "./io.js";

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
	readonly requestQueueCapacity?: number;
	readonly eventCapacity?: number;
	readonly eventBufferCapacity?: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly agentSessionOverrides?: PlotAgentSessionCliOverrides;
	readonly createAgentSession?: CreateAgentSession;
}
export interface ServeStdioOptions extends BaseRunOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Promise<void> | void;
}
export interface ServeSupervisorOptions extends BaseRunOptions {
	readonly writeStderr?: (line: string) => Promise<void> | void;
}
export interface RunInProcessOnceOptions extends BaseRunOptions {
	readonly onEvent?: (event: EventLogEvent) => Promise<void> | void;
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
const provideCliLogger = async <A>(
	options: BaseRunOptions,
	work: () => Promise<A> | A,
): Promise<A> => {
	LoggerLive({ level: toLogLevel(options.logLevel), stderr: true });
	return work();
};

export const runInProcessOnce = (
	options: RunInProcessOnceOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run_once",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			async () => {
				await runPlotSessionHostOnce(options);
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

export const serveSupervisor = (
	options: ServeSupervisorOptions,
): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.serve_supervisor",
			{ cwd: options.cwd },
			async () => {
				const { socketPath, server, supervisor } =
					await startPlotSupervisorIpcServer({
						options: {
							cwd: options.cwd,
							...(options.plotDir === undefined
								? {}
								: { plotDir: options.plotDir }),
							...(options.agentDir === undefined
								? {}
								: { agentDir: options.agentDir }),
							cli: resolvePlotCliSpawnCommand(),
						},
					});
				let shuttingDown: Promise<void> | undefined;
				const shutdown = (exitCode: number) => {
					shuttingDown ??= (async () => {
						server.close();
						await supervisor.shutdown();
						if (existsSync(socketPath)) unlinkSync(socketPath);
					})();
					void shuttingDown.finally(() => process.exit(exitCode));
				};
				process.once("SIGINT", () => shutdown(0));
				process.once("SIGTERM", () => shutdown(0));
				process.once("uncaughtException", (error) => {
					void options.writeStderr?.(`${errorMessage(error)}\n`);
					shutdown(1);
				});
				process.once("unhandledRejection", (reason) => {
					void options.writeStderr?.(`${errorMessage(reason)}\n`);
					shutdown(1);
				});
				await options.writeStderr?.(`Plot supervisor: ${socketPath}\n`);
				await new Promise<void>(() => {});
			},
		),
	);
