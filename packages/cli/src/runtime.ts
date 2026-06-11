import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import {
	runPlotSessionHostDaemon,
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
export interface RunDaemonOptions extends BaseRunOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Promise<void> | void;
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
export const runDaemon = (options: RunDaemonOptions): Promise<void> =>
	provideCliLogger(options, () =>
		withWideEvent(
			"plot_cli.run",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			() => runPlotSessionHostDaemon(options),
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
