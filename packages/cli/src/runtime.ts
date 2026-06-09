import { Effect, Layer } from "effect";
import { positiveInt, sourceId, subjectKey, workKey } from "@plot/agent/model";
import type { WorkSource } from "@plot/agent/work-source";
import { LoggerLive, withWideEvent } from "@plot/common/observability";
import { AgentSessionClientLive } from "@plot/session/agent-session-client";
import {
	makePlotSessionLayer,
	plotSessionId,
} from "@plot/session/plot-session";
import { makePlotProtocolLayer } from "@plot/session/protocol-handler";
import {
	PlotProtocolLimits,
	defaultPlotProtocolLimits,
	plotProtocolEpoch,
} from "@plot/session/protocol";
import {
	runPlotProtocolStdio,
	type StdioChunk,
} from "@plot/session/protocol-stdio";
import {
	loadWorkflowFromNode,
	type WorkflowDefinition,
} from "@plot/session/workflow";
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
	readonly workflowPath: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly logLevel: LogLevelFlag;
	readonly logFormat: LogFormat;
	readonly requestQueueCapacity: number;
	readonly eventCapacity: number;
	readonly replayCapacity: number;
	readonly tickIntervalMs?: number;
	readonly maxRunDurationMs?: number;
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
}

const workflowSourceId = sourceId("workflow");
const workflowSubject = subjectKey("workflow");
const workflowWorkKey = workKey("workflow:default");

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

const makeWorkflowSource = (workflow: WorkflowDefinition): WorkSource => ({
	id: workflowSourceId,
	selectWork: ({ snapshot }) => {
		if (snapshot.running.has(workflowWorkKey)) return Effect.succeed([]);
		const completed = snapshot.completions.some(
			(completion) => completion.workKey === workflowWorkKey,
		);
		if (completed) return Effect.succeed([]);
		return Effect.succeed([
			{
				workKey: workflowWorkKey,
				subject: workflowSubject,
				templateContext: { workflow: workflow.config },
			},
		]);
	},
});

const makeLimits = (options: ServeStdioOptions) =>
	new PlotProtocolLimits({
		...defaultPlotProtocolLimits,
		maxPendingRequests: positiveInt(options.requestQueueCapacity),
		maxEventBufferEvents: positiveInt(options.replayCapacity),
	});

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
			workflow_path: options.workflowPath,
			session_id: options.sessionId,
		},
		Effect.gen(function* () {
			const workflow = yield* loadWorkflowFromNode(options.workflowPath);
			const agentOptions = {
				queueCapacity: options.requestQueueCapacity,
				eventCapacity: options.eventCapacity,
				...(options.tickIntervalMs === undefined
					? {}
					: { tickIntervalMs: options.tickIntervalMs }),
				...(options.maxRunDurationMs === undefined
					? {}
					: { maxRunDurationMs: options.maxRunDurationMs }),
			};
			const sessionLayer = makePlotSessionLayer({
				id: plotSessionId(options.sessionId),
				workflow,
				sources: [makeWorkflowSource(workflow)],
				eventCapacity: options.eventCapacity,
				agent: agentOptions,
				agentRunner: {
					prompt: workflow.prompt,
					create: { cwd: options.cwd },
				},
			}).pipe(Layer.provide(AgentSessionClientLive));
			const protocolLayer = makePlotProtocolLayer({
				epoch: plotProtocolEpoch(options.sessionId),
				limits: makeLimits(options),
				outputCapacity: options.requestQueueCapacity,
			}).pipe(Layer.provide(sessionLayer));

			yield* runPlotProtocolStdio({
				stdin: options.stdin,
				writeStdout: options.writeStdout,
				limits: makeLimits(options),
			}).pipe(Effect.provide(protocolLayer));
		}),
	).pipe(Effect.provide(loggerLayer));
};
