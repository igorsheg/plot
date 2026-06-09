import {
	Context,
	Effect,
	Layer,
	PubSub,
	Ref,
	Schema,
	Scope,
	Stream,
	type Exit,
} from "effect";
import type { AgentSessionEvent } from "@plot/agent-session/client";
import * as Domain from "@plot/core/domain";
import type {
	OrchestratorEvent,
	PlotLoopError,
	RuntimeSnapshot,
	SubjectKey,
	TickResult,
	WorkResult,
} from "@plot/core/domain";
import { makeOrchestratorLayer, Orchestrator } from "@plot/core/loop";
import type { OrchestratorLayerOptions } from "@plot/core/loop";
import type { WorkRunner, WorkRunnerContext } from "@plot/core/runner";
import type { WorkSource } from "@plot/core/source";
import {
	AgentSessionClient,
	type AgentSessionClientShape,
	type PromptAgentSessionOptions,
} from "@plot/agent-session/client";
import type { AgentSessionWorkRunnerOptions } from "@plot/agent-session/runner";
import type { WorkflowDefinition } from "./workflow.js";

export const PlotSessionId = Schema.NonEmptyString.pipe(
	Schema.brand("PlotSessionId"),
);
export type PlotSessionId = typeof PlotSessionId.Type;
export const plotSessionId = (value: string): PlotSessionId =>
	Schema.decodeUnknownSync(PlotSessionId)(value);

export const PlotSessionEventSequence = Schema.Number.pipe(
	Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
	Schema.brand("PlotSessionEventSequence"),
);
export type PlotSessionEventSequence = typeof PlotSessionEventSequence.Type;
export const plotSessionEventSequence = (
	value: number,
): PlotSessionEventSequence =>
	Schema.decodeUnknownSync(PlotSessionEventSequence)(value);

export class SessionStartedEvent extends Schema.Class<SessionStartedEvent>(
	"SessionStartedEvent",
)({
	type: Schema.Literal("session_started"),
	sessionId: PlotSessionId,
	sequence: PlotSessionEventSequence,
}) {}

export class SessionShutdownEvent extends Schema.Class<SessionShutdownEvent>(
	"SessionShutdownEvent",
)({
	type: Schema.Literal("session_shutdown"),
	sessionId: PlotSessionId,
	sequence: PlotSessionEventSequence,
}) {}

export class OrchestratorSessionEvent extends Schema.Class<OrchestratorSessionEvent>(
	"OrchestratorSessionEvent",
)({
	type: Schema.Literal("orchestrator_event"),
	sessionId: PlotSessionId,
	sequence: PlotSessionEventSequence,
	event: Domain.OrchestratorEvent,
}) {}

export class AgentSessionStreamEvent extends Schema.Class<AgentSessionStreamEvent>(
	"AgentSessionStreamEvent",
)({
	type: Schema.Literal("agent_event"),
	sessionId: PlotSessionId,
	sequence: PlotSessionEventSequence,
	sourceId: Domain.SourceId,
	runId: Domain.RunId,
	workKey: Domain.WorkKey,
	subject: Schema.optionalKey(Domain.SubjectKey),
	eventType: Schema.String,
	event: Schema.Unknown,
}) {}

export const PlotSessionEvent = Schema.Union([
	SessionStartedEvent,
	SessionShutdownEvent,
	OrchestratorSessionEvent,
	AgentSessionStreamEvent,
]);
export type PlotSessionEvent = typeof PlotSessionEvent.Type;

export class PlotSessionError extends Schema.TaggedErrorClass<PlotSessionError>()(
	"PlotSessionError",
	{
		phase: Schema.Literals(["setup"]),
		message: Schema.String,
	},
) {}

interface AgentSessionRunnerConfig extends Omit<
	AgentSessionWorkRunnerOptions,
	"onEvent"
> {
	readonly onEvent?: (event: AgentSessionEvent) => Effect.Effect<void, unknown>;
}

export interface PlotSessionShape {
	readonly id: PlotSessionId;
	readonly workflow: WorkflowDefinition;
	readonly start: () => Effect.Effect<void>;
	readonly tickOnce: () => Effect.Effect<TickResult>;
	readonly snapshot: () => Effect.Effect<RuntimeSnapshot>;
	readonly events: () => Stream.Stream<PlotSessionEvent>;
	readonly shutdown: () => Effect.Effect<boolean>;
}

export class PlotSession extends Context.Service<
	PlotSession,
	PlotSessionShape
>()("@plot/session/PlotSession") {}

interface BasePlotSessionLayerOptions {
	readonly id?: PlotSessionId;
	readonly workflow: WorkflowDefinition;
	readonly sources: readonly WorkSource[];
	readonly orchestrator?: Omit<OrchestratorLayerOptions, "sources" | "runner">;
	readonly eventCapacity?: number;
}

export interface ExplicitRunnerPlotSessionLayerOptions extends BasePlotSessionLayerOptions {
	readonly runner: WorkRunner;
	readonly agentRunner?: never;
}

export interface AgentRunnerPlotSessionLayerOptions extends BasePlotSessionLayerOptions {
	readonly runner?: never;
	readonly agentRunner: AgentSessionRunnerConfig;
}

export type PlotSessionLayerOptions =
	| ExplicitRunnerPlotSessionLayerOptions
	| AgentRunnerPlotSessionLayerOptions;

const makeSetupError = (message: string) =>
	new PlotSessionError({ phase: "setup", message });

const ensureOneRunner = (
	options: PlotSessionLayerOptions,
): Effect.Effect<void, PlotSessionError> => {
	const runnerCount =
		(options.runner === undefined ? 0 : 1) +
		(options.agentRunner === undefined ? 0 : 1);
	if (runnerCount === 1) return Effect.void;
	return new PlotSessionError({
		phase: "setup",
		message: "exactly one of runner or agentRunner is required",
	});
};

const decodeEventCapacity = (value: number | undefined) =>
	Schema.decodeUnknownEffect(Schema.Number.pipe(Schema.check(Schema.isInt())))(
		value ?? 256,
	).pipe(
		Effect.filterOrFail(
			(capacity) => capacity > 0,
			() => makeSetupError("eventCapacity must be a positive integer"),
		),
		Effect.mapError(() =>
			makeSetupError("eventCapacity must be a positive integer"),
		),
	);

const publishScoped = <A>(pubsub: PubSub.PubSub<A>, event: A) =>
	PubSub.publish(pubsub, event).pipe(Effect.ignore);

const nextSequence = (sequenceRef: Ref.Ref<number>) =>
	Ref.modify(sequenceRef, (current) => {
		const next = current + 1;
		return [plotSessionEventSequence(next), next] as const;
	});

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

const optionalSubject = (subject: SubjectKey | undefined) =>
	subject === undefined ? {} : { subject };

const resolveRequiredRunnerValue = <A>(
	value: A | ((context: WorkRunnerContext) => Effect.Effect<A, unknown>),
	context: WorkRunnerContext,
) => {
	if (typeof value === "function") {
		return (value as (context: WorkRunnerContext) => Effect.Effect<A, unknown>)(
			context,
		);
	}
	return Effect.succeed(value);
};

const resolveOptionalRunnerValue = <A>(
	value:
		| A
		| ((context: WorkRunnerContext) => Effect.Effect<A, unknown>)
		| undefined,
	context: WorkRunnerContext,
) => {
	if (value === undefined) return Effect.void;
	return resolveRequiredRunnerValue(value, context);
};

const makeAgentRunner = (
	client: AgentSessionClientShape,
	config: AgentSessionRunnerConfig,
	publishAgentEvent: (
		context: WorkRunnerContext,
		event: AgentSessionEvent,
	) => Effect.Effect<void>,
): WorkRunner => {
	return {
		run: (context): Effect.Effect<WorkResult, unknown> =>
			Effect.gen(function* () {
				const prompt = yield* resolveRequiredRunnerValue(
					config.prompt,
					context,
				);
				const create = yield* resolveOptionalRunnerValue(
					config.create,
					context,
				);
				const promptOptions = yield* resolveOptionalRunnerValue(
					config.promptOptions,
					context,
				);
				const request: PromptAgentSessionOptions = {
					prompt,
					...(create === undefined ? {} : { create }),
					...(promptOptions === undefined ? {} : { promptOptions }),
					log: {
						source_id: context.sourceId,
						run_id: context.run.runId,
						work_key: context.work.workKey,
						tick_id: context.tickId,
					},
				};
				const notifyExternalListener = (event: AgentSessionEvent) =>
					config.onEvent
						? config.onEvent(event).pipe(
								Effect.catch((error) =>
									Effect.logWarning("PlotSession.agentRunner.onEvent failed", {
										error: errorMessage(error),
										event_type: event.type,
										source_id: context.sourceId,
										run_id: context.run.runId,
										work_key: context.work.workKey,
									}),
								),
							)
						: Effect.void;
				yield* client
					.prompt(request)
					.pipe(
						Stream.runForEach((event) =>
							publishAgentEvent(context, event).pipe(
								Effect.andThen(notifyExternalListener(event)),
							),
						),
					);
				return {};
			}),
	};
};

export function makePlotSessionLayer(
	options: ExplicitRunnerPlotSessionLayerOptions,
): Layer.Layer<PlotSession, PlotSessionError | PlotLoopError>;
export function makePlotSessionLayer(
	options: AgentRunnerPlotSessionLayerOptions,
): Layer.Layer<
	PlotSession,
	PlotSessionError | PlotLoopError,
	AgentSessionClient
>;
export function makePlotSessionLayer(
	options: PlotSessionLayerOptions,
): Layer.Layer<
	PlotSession,
	PlotSessionError | PlotLoopError,
	AgentSessionClient
> {
	const sessionId = options.id ?? plotSessionId("default");

	return Layer.effect(
		PlotSession,
		Effect.gen(function* () {
			yield* ensureOneRunner(options);
			const eventCapacity = yield* decodeEventCapacity(options.eventCapacity);
			const events = yield* PubSub.sliding<PlotSessionEvent>(eventCapacity);
			const sequence = yield* Ref.make(0);
			const sessionScope = yield* Scope.make();
			yield* Effect.addFinalizer((exit: Exit.Exit<unknown, unknown>) =>
				Scope.close(sessionScope, exit),
			);

			const publish = (event: PlotSessionEvent) => publishScoped(events, event);
			const publishSessionStarted = Effect.gen(function* () {
				const sequenceNumber = yield* nextSequence(sequence);
				yield* publish(
					new SessionStartedEvent({
						type: "session_started",
						sessionId,
						sequence: sequenceNumber,
					}),
				);
			});
			const publishSessionShutdown = Effect.gen(function* () {
				const sequenceNumber = yield* nextSequence(sequence);
				yield* publish(
					new SessionShutdownEvent({
						type: "session_shutdown",
						sessionId,
						sequence: sequenceNumber,
					}),
				);
			});
			const publishOrchestratorEvent = (event: OrchestratorEvent) =>
				Effect.gen(function* () {
					const sequenceNumber = yield* nextSequence(sequence);
					yield* publish(
						new OrchestratorSessionEvent({
							type: "orchestrator_event",
							sessionId,
							sequence: sequenceNumber,
							event,
						}),
					);
				});
			const publishAgentEvent = (
				context: WorkRunnerContext,
				event: AgentSessionEvent,
			) =>
				Effect.gen(function* () {
					const sequenceNumber = yield* nextSequence(sequence);
					yield* publish(
						new AgentSessionStreamEvent({
							type: "agent_event",
							sessionId,
							sequence: sequenceNumber,
							sourceId: context.sourceId,
							runId: context.run.runId,
							workKey: context.work.workKey,
							...optionalSubject(context.work.subject),
							eventType: event.type,
							event,
						}),
					);
				});

			const runner = options.runner
				? options.runner
				: makeAgentRunner(
						yield* AgentSessionClient,
						options.agentRunner,
						publishAgentEvent,
					);
			const orchestratorLayer = makeOrchestratorLayer({
				...options.orchestrator,
				sources: options.sources,
				runner,
			});
			const orchestratorContext = yield* Layer.buildWithScope(
				orchestratorLayer,
				sessionScope,
			);
			const orchestrator = Context.get(orchestratorContext, Orchestrator);
			yield* orchestrator
				.events()
				.pipe(
					Stream.runForEach(publishOrchestratorEvent),
					Effect.forkIn(sessionScope, { startImmediately: true }),
					Effect.asVoid,
				);

			const start = Effect.fn("PlotSession.start")(function* () {
				yield* publishSessionStarted;
				yield* orchestrator.start();
			});
			const tickOnce = Effect.fn("PlotSession.tickOnce")(function* () {
				return yield* orchestrator.tickOnce();
			});
			const snapshot = Effect.fn("PlotSession.snapshot")(function* () {
				return yield* orchestrator.snapshot();
			});
			const eventStream = () => Stream.fromPubSub(events);
			const shutdown = Effect.fn("PlotSession.shutdown")(function* () {
				const accepted = yield* orchestrator.shutdown();
				yield* publishSessionShutdown;
				return accepted;
			});

			return {
				id: sessionId,
				workflow: options.workflow,
				start,
				tickOnce,
				snapshot,
				events: eventStream,
				shutdown,
			} satisfies PlotSessionShape;
		}),
	);
}
