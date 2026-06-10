import { Effect, Layer } from "effect";
import { positiveInt, sourceId, subjectKey, workKey } from "@plot/agent/model";
import type { WorkSource } from "@plot/agent/work-source";
import { makeAgentSessionClientLayer } from "./agent-session-client.js";
import type { CreateAgentSession } from "./agent-session-types.js";
import {
	makePlotCreateAgentSession,
	type PlotAgentSessionCliOverrides,
} from "./pi-agent-session.js";
import { makePlotAuth } from "./pi-auth.js";
import { resolvePlotPaths } from "./plot-paths.js";
import { makePlotSessionLayer, plotSessionId } from "./plot-session.js";
import { makePlotProtocolLayer } from "./protocol-handler.js";
import {
	PlotProtocolLimits,
	defaultPlotProtocolLimits,
	plotProtocolEpoch,
} from "./protocol.js";
import { runPlotProtocolStdio, type StdioChunk } from "./protocol-stdio.js";
import {
	loadDiscoveredWorkflowFromNode,
	type WorkflowDefinition,
} from "./workflow.js";

export interface PlotSessionHostStdioOptions {
	readonly workflowPath?: string;
	readonly sessionId: string;
	readonly cwd: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
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

const workflowSourceId = sourceId("workflow");
const workflowSubject = subjectKey("workflow");
const workflowWorkKey = workKey("workflow:default");

export const makeOneShotWorkflowSource = (
	workflow: WorkflowDefinition,
): WorkSource => ({
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

export const makePlotProtocolLimits = (values: {
	readonly requestQueueCapacity: number;
	readonly replayCapacity: number;
}) =>
	new PlotProtocolLimits({
		...defaultPlotProtocolLimits,
		maxPendingRequests: positiveInt(values.requestQueueCapacity),
		maxEventBufferEvents: positiveInt(values.replayCapacity),
	});

export const runPlotSessionHostStdio = (
	options: PlotSessionHostStdioOptions,
): Effect.Effect<void, unknown> =>
	Effect.gen(function* () {
		const workflow = yield* loadDiscoveredWorkflowFromNode({
			cwd: options.cwd,
			...(options.workflowPath === undefined
				? {}
				: { workflowPath: options.workflowPath }),
		});
		const paths = resolvePlotPaths({
			cwd: options.cwd,
			...(options.plotDir === undefined ? {} : { plotDir: options.plotDir }),
			...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
			...(options.sessionDir === undefined
				? {}
				: { sessionDir: options.sessionDir }),
		});
		const plot = workflow.runtime.plot;
		const requestQueueCapacity =
			options.requestQueueCapacity ?? plot?.queueCapacity ?? 64;
		const eventCapacity = options.eventCapacity ?? plot?.eventCapacity ?? 256;
		const replayCapacity =
			options.replayCapacity ?? plot?.replayCapacity ?? 1024;
		const tickIntervalMs = options.tickIntervalMs ?? plot?.tickIntervalMs;
		const maxRunDurationMs = options.maxRunDurationMs ?? plot?.maxRunDurationMs;
		const agentOptions = {
			queueCapacity: requestQueueCapacity,
			eventCapacity,
			...(tickIntervalMs === undefined ? {} : { tickIntervalMs }),
			...(maxRunDurationMs === undefined ? {} : { maxRunDurationMs }),
		};
		const createAgentSession =
			options.createAgentSession ??
			makePlotCreateAgentSession({
				workflow,
				paths,
				...(options.agentSessionOverrides === undefined
					? {}
					: { overrides: options.agentSessionOverrides }),
			});
		const agentSessionClientLayer = makeAgentSessionClientLayer({
			createAgentSession,
		});
		const sessionLayer = makePlotSessionLayer({
			id: plotSessionId(options.sessionId),
			workflow,
			sources: [makeOneShotWorkflowSource(workflow)],
			eventCapacity,
			agent: agentOptions,
			agentRunner: {
				prompt: workflow.prompt,
				create: { cwd: paths.cwd },
			},
		}).pipe(Layer.provide(agentSessionClientLayer));
		const limits = makePlotProtocolLimits({
			requestQueueCapacity,
			replayCapacity,
		});
		const protocolLayer = makePlotProtocolLayer({
			epoch: plotProtocolEpoch(options.sessionId),
			limits,
			outputCapacity: requestQueueCapacity,
			auth: makePlotAuth(paths),
		}).pipe(Layer.provide(sessionLayer));

		yield* runPlotProtocolStdio({
			stdin: options.stdin,
			writeStdout: options.writeStdout,
			limits,
		}).pipe(Effect.provide(protocolLayer));
	});
