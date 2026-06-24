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
import { resolveWorkflowPath } from "@plot/session/workflow";

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
