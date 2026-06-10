import { Effect } from "effect";
import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import {
	runPlotSessionHostOnce,
	runPlotSessionHostStdio,
	type PlotSessionHostRunResult,
} from "@plot/session/session-host";
import { resolveWorkflowPath } from "@plot/session/workflow";
import type { LogLevel as EffectLogLevel } from "effect/LogLevel";

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
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
}

export interface RunOnceOptions extends BaseRunOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Effect.Effect<void, unknown>;
}

const toLogLevel = (level: LogLevelFlag): EffectLogLevel => {
	switch (level) {
		case "trace":
			return "Trace";
		case "debug":
			return "Debug";
		case "info":
			return "Info";
		case "warn":
			return "Warn";
		case "error":
			return "Error";
		case "fatal":
			return "Fatal";
		case "none":
			return "None";
	}
};

const workflowPathLogField = (options: BaseRunOptions) =>
	resolveWorkflowPath({
		cwd: options.cwd,
		...(options.workflowPath === undefined
			? {}
			: { workflowPath: options.workflowPath }),
	});

const provideCliLogger = <A>(
	options: BaseRunOptions,
	effect: Effect.Effect<A, unknown>,
) =>
	effect.pipe(
		Effect.provide(
			LoggerLive({
				format: options.logFormat,
				level: toLogLevel(options.logLevel),
				stderr: true,
			}),
		),
	);

export const runOnce = (
	options: RunOnceOptions,
): Effect.Effect<PlotSessionHostRunResult, unknown> =>
	provideCliLogger(
		options,
		withWideEvent(
			"plot_cli.run",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			runPlotSessionHostOnce(options),
		),
	);

export const serveStdio = (
	options: ServeStdioOptions,
): Effect.Effect<void, unknown> =>
	provideCliLogger(
		options,
		withWideEvent(
			"plot_cli.serve_stdio",
			{
				workflow_path: workflowPathLogField(options),
				session_id: options.sessionId,
			},
			runPlotSessionHostStdio(options),
		),
	);
