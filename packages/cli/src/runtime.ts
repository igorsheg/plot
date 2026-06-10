import { Effect } from "effect";
import { LoggerLive, withWideEvent } from "@plot/common/observability";
import type { CreateAgentSession } from "@plot/session/agent-session-types";
import type { PlotAgentSessionCliOverrides } from "@plot/session/pi-agent-session";
import type { StdioChunk } from "@plot/session/protocol-stdio";
import { runPlotSessionHostStdio } from "@plot/session/session-host";
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

export interface ServeStdioOptions {
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
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
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

export const serveStdio = (
	options: ServeStdioOptions,
): Effect.Effect<void, unknown> => {
	const loggerLayer = LoggerLive({
		format: options.logFormat,
		level: toLogLevel(options.logLevel),
		stderr: true,
	});

	return withWideEvent(
		"plot_cli.serve_stdio",
		{
			workflow_path: resolveWorkflowPath({
				cwd: options.cwd,
				...(options.workflowPath === undefined
					? {}
					: { workflowPath: options.workflowPath }),
			}),
			session_id: options.sessionId,
		},
		runPlotSessionHostStdio(options),
	).pipe(Effect.provide(loggerLayer));
};
