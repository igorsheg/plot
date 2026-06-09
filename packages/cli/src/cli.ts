import { Effect, Option, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { serveStdio, type LogFormat, type LogLevelFlag } from "./runtime.js";
import type { CreateAgentSession } from "@plot/session/agent-session-client";
import type { StdioChunk } from "@plot/session/protocol-stdio";

export const version = "0.0.0";

export interface PlotCliIo {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
	readonly createAgentSession?: CreateAgentSession;
}

class PlotCliIoError extends Schema.TaggedErrorClass<PlotCliIoError>()(
	"PlotCliIoError",
	{ message: Schema.String },
) {}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const writeProcessStdout = (line: string) =>
	Effect.tryPromise({
		try: () =>
			new Promise<void>((resolve, reject) => {
				process.stdout.write(line, (error?: Error | null) => {
					if (error) reject(error);
					else resolve();
				});
			}),
		catch: (error) => new PlotCliIoError({ message: errorMessage(error) }),
	});

export const processCliIo = (): PlotCliIo => ({
	stdin: process.stdin as AsyncIterable<StdioChunk>,
	writeStdout: writeProcessStdout,
});

const workflowFlag = Flag.string("workflow").pipe(
	Flag.withDefault("WORKFLOW.md"),
	Flag.withDescription("Path to the WORKFLOW.md contract to load"),
);

const sessionIdFlag = Flag.string("session-id").pipe(
	Flag.withDefault("default"),
	Flag.withDescription("Protocol epoch and Plot session identifier"),
);

const cwdFlag = Flag.string("cwd").pipe(
	Flag.withDefault(process.cwd()),
	Flag.withDescription("Working directory used by the agent session"),
);

const logLevelFlag = Flag.choice("log-level", [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"none",
] as const).pipe(
	Flag.withDefault("info" as const),
	Flag.withDescription("Minimum telemetry level written to stderr"),
);

const logFormatFlag = Flag.choice("log-format", [
	"json",
	"logfmt",
	"pretty",
] as const).pipe(
	Flag.withDefault("json" as const),
	Flag.withDescription("Telemetry format written to stderr"),
);

const requestQueueCapacityFlag = Flag.integer("request-queue-capacity").pipe(
	Flag.withDefault(64),
	Flag.withDescription("Maximum queued protocol requests"),
);

const eventCapacityFlag = Flag.integer("event-capacity").pipe(
	Flag.withDefault(256),
	Flag.withDescription("Maximum in-memory session and agent event capacity"),
);

const replayCapacityFlag = Flag.integer("replay-capacity").pipe(
	Flag.withDefault(1024),
	Flag.withDescription("Maximum retained protocol events for subscribe replay"),
);

const tickIntervalMsFlag = Flag.optional(
	Flag.integer("tick-interval-ms").pipe(
		Flag.withDescription("Optional autonomous periodic tick cadence in millis"),
	),
);

const maxRunDurationMsFlag = Flag.optional(
	Flag.integer("max-run-duration-ms").pipe(
		Flag.withDescription("Optional watchdog timeout for one selected work run"),
	),
);

const makeServeStdioCommand = (io: PlotCliIo) =>
	Command.make(
		"stdio",
		{
			workflowPath: workflowFlag,
			sessionId: sessionIdFlag,
			cwd: cwdFlag,
			logLevel: logLevelFlag,
			logFormat: logFormatFlag,
			requestQueueCapacity: requestQueueCapacityFlag,
			eventCapacity: eventCapacityFlag,
			replayCapacity: replayCapacityFlag,
			tickIntervalMs: tickIntervalMsFlag,
			maxRunDurationMs: maxRunDurationMsFlag,
		},
		(options) => {
			const tickIntervalMs = Option.getOrUndefined(options.tickIntervalMs);
			const maxRunDurationMs = Option.getOrUndefined(options.maxRunDurationMs);
			return serveStdio({
				workflowPath: options.workflowPath,
				sessionId: options.sessionId,
				cwd: options.cwd,
				logLevel: options.logLevel as LogLevelFlag,
				logFormat: options.logFormat as LogFormat,
				requestQueueCapacity: options.requestQueueCapacity,
				eventCapacity: options.eventCapacity,
				replayCapacity: options.replayCapacity,
				...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
				...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
				...(io.createAgentSession === undefined
					? {}
					: { createAgentSession: io.createAgentSession }),
				stdin: io.stdin,
				writeStdout: io.writeStdout,
			});
		},
	).pipe(
		Command.withDescription(
			"Serve the plot.v1 protocol over stdin/stdout JSONL",
		),
	);

export const makePlotCommand = (io: PlotCliIo = processCliIo()) => {
	const serve = Command.make("serve").pipe(
		Command.withDescription("Serve Plot machine integration protocols"),
		Command.withSubcommands([makeServeStdioCommand(io)]),
	);

	return Command.make("plot").pipe(
		Command.withDescription("Autonomous Plot runtime"),
		Command.withSubcommands([serve]),
	);
};

export const runPlotCli = (
	args: readonly string[],
	io: PlotCliIo = processCliIo(),
) => Command.runWith(makePlotCommand(io), { version })(args);
