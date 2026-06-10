import { Context, Deferred, Effect, Fiber, Layer, Stream } from "effect";
import {
	positiveInt,
	sourceId,
	subjectKey,
	workKey,
	type Completion,
} from "@plot/agent/model";
import type { WorkSource } from "@plot/agent/work-source";
import { makeAgentSessionClientLayer } from "./agent-session-client.js";
import type { CreateAgentSession } from "./agent-session-types.js";
import {
	makePlotCreateAgentSession,
	type PlotAgentSessionCliOverrides,
} from "./pi-agent-session.js";
import { makePlotAuth } from "./pi-auth.js";
import { resolvePlotPaths, type PlotPaths } from "./plot-paths.js";
import {
	makePlotSessionLayer,
	PlotSession,
	plotSessionId,
	type PlotSessionEvent,
} from "./plot-session.js";
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

export interface PlotSessionHostOptions {
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
}

export interface PlotSessionHostStdioOptions extends PlotSessionHostOptions {
	readonly stdin: AsyncIterable<StdioChunk>;
	readonly writeStdout: (line: string) => Effect.Effect<void, unknown>;
}

export interface PlotSessionHostRunOptions extends PlotSessionHostOptions {
	readonly onEvent?: (event: PlotSessionEvent) => Effect.Effect<void, unknown>;
}

export interface PlotSessionHostRunResult {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly completion: Completion;
}

interface HostComposition {
	readonly workflow: WorkflowDefinition;
	readonly paths: PlotPaths;
	readonly requestQueueCapacity: number;
	readonly replayCapacity: number;
	readonly sessionLayer: Layer.Layer<PlotSession, unknown, never>;
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

const makeHostComposition = (
	options: PlotSessionHostOptions,
): Effect.Effect<HostComposition, unknown> =>
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

		return {
			workflow,
			paths,
			requestQueueCapacity,
			replayCapacity,
			sessionLayer,
		};
	});

const completionFromTickResult = (result: {
	readonly completions: readonly Completion[];
}): Completion | undefined =>
	result.completions.find(
		(completion) => completion.workKey === workflowWorkKey,
	);

const completionFromEvent = (
	event: PlotSessionEvent,
): Completion | undefined => {
	if (event.type !== "plot_agent_event") return undefined;
	if (event.event.type !== "work_completed") return undefined;
	if (event.event.completion.workKey !== workflowWorkKey) return undefined;
	return event.event.completion;
};

const isWorkflowAgentEnd = (event: PlotSessionEvent) =>
	event.type === "agent_session_event" &&
	event.workKey === workflowWorkKey &&
	event.eventType === "agent_end";

export const runPlotSessionHostOnce = (
	options: PlotSessionHostRunOptions,
): Effect.Effect<PlotSessionHostRunResult, unknown> =>
	Effect.scoped(
		Effect.gen(function* () {
			const host = yield* makeHostComposition(options);
			const context = yield* Layer.build(host.sessionLayer);
			const session = Context.get(context, PlotSession);
			const completed = yield* Deferred.make<Completion>();
			const agentEnded = yield* Deferred.make<void>();
			const events = session.events().pipe(
				Stream.runForEach((event) => {
					const emit = options.onEvent?.(event) ?? Effect.void;
					const completion = completionFromEvent(event);
					if (completion !== undefined) {
						return emit.pipe(
							Effect.andThen(Deferred.succeed(completed, completion)),
							Effect.asVoid,
						);
					}
					if (isWorkflowAgentEnd(event)) {
						return emit.pipe(
							Effect.andThen(Deferred.succeed(agentEnded, undefined)),
							Effect.asVoid,
						);
					}
					return emit;
				}),
			);
			const eventsFiber = yield* events.pipe(
				Effect.forkScoped({ startImmediately: true }),
			);
			const firstTick = yield* session.tickOnce();
			let completion = completionFromTickResult(firstTick);
			if (completion === undefined) {
				completion = yield* Deferred.await(completed).pipe(
					Effect.race(Deferred.await(agentEnded).pipe(Effect.as(undefined))),
				);
			}
			while (completion === undefined) {
				yield* Effect.sleep(50);
				const tick = yield* session.tickOnce();
				completion = completionFromTickResult(tick);
			}
			yield* Fiber.interrupt(eventsFiber);
			yield* session.shutdown();
			return { workflow: host.workflow, paths: host.paths, completion };
		}),
	);

export const runPlotSessionHostStdio = (
	options: PlotSessionHostStdioOptions,
): Effect.Effect<void, unknown> =>
	Effect.gen(function* () {
		const host = yield* makeHostComposition(options);
		const limits = makePlotProtocolLimits({
			requestQueueCapacity: host.requestQueueCapacity,
			replayCapacity: host.replayCapacity,
		});
		const protocolLayer = makePlotProtocolLayer({
			epoch: plotProtocolEpoch(options.sessionId),
			limits,
			outputCapacity: host.requestQueueCapacity,
			auth: makePlotAuth(host.paths),
		}).pipe(Layer.provide(host.sessionLayer));

		yield* runPlotProtocolStdio({
			stdin: options.stdin,
			writeStdout: options.writeStdout,
			limits,
		}).pipe(Effect.provide(protocolLayer));
	});
