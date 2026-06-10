import { Cause, Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import {
	createAgentSession,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
	logWideEvent,
	withFields,
	withWideEvent,
	type Fields,
	type WideEventLevel,
} from "@plot/common/observability";

import type {
	AgentSessionEvent,
	CreateAgentSession,
	CreateAgentSessionOptions,
	PromptOptions,
} from "./agent-session-types.js";

const AgentSessionClientErrorPhase = Schema.Literals([
	"create",
	"prompt",
	"dispose",
]);
export type AgentSessionClientErrorPhase =
	typeof AgentSessionClientErrorPhase.Type;

export class AgentSessionClientError extends Schema.TaggedErrorClass<AgentSessionClientError>()(
	"AgentSessionClientError",
	{
		phase: AgentSessionClientErrorPhase,
		message: Schema.String,
	},
) {}

export interface PromptAgentSessionOptions {
	readonly create?: CreateAgentSessionOptions;
	readonly prompt: string;
	readonly promptOptions?: PromptOptions;
	readonly log?: Fields;
}

export interface AgentSessionClientShape {
	readonly prompt: (
		options: PromptAgentSessionOptions,
	) => Stream.Stream<AgentSessionEvent, AgentSessionClientError>;
}

export class AgentSessionClient extends Context.Service<
	AgentSessionClient,
	AgentSessionClientShape
>()("@plot/session/AgentSessionClient") {}

export interface AgentSessionClientLayerOptions {
	readonly createAgentSession?: CreateAgentSession;
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const createError = (phase: AgentSessionClientErrorPhase, error: unknown) =>
	new AgentSessionClientError({ phase, message: errorMessage(error) });

const disposeSession = (session: AgentSession) =>
	Effect.try({
		try: () => session.dispose(),
		catch: (error) => createError("dispose", error),
	}).pipe(
		Effect.catch((error) =>
			logWideEvent(
				{
					operation: "agent_session.dispose",
					outcome: "error",
					error: error.message,
				},
				"error",
			),
		),
		Effect.asVoid,
	);

const sessionEventFields = (event: AgentSessionEvent): Fields => {
	const fields: Fields = { event_type: event.type };
	if ("toolName" in event && typeof event.toolName === "string")
		fields["tool_name"] = event.toolName;
	if ("toolCallId" in event && typeof event.toolCallId === "string")
		fields["tool_call_id"] = event.toolCallId;
	if (event.type === "auto_retry_start")
		fields["retry_attempt"] = event.attempt;
	if (event.type === "auto_retry_end") fields["retry_success"] = event.success;
	return fields;
};

const sessionEventLogLevel = (event: AgentSessionEvent): WideEventLevel => {
	if (
		event.type === "message_start" ||
		event.type === "message_update" ||
		event.type === "message_end" ||
		event.type === "tool_execution_update"
	) {
		return "debug";
	}
	return "info";
};

export const makeAgentSessionClientLayer = (
	options: AgentSessionClientLayerOptions = {},
) => {
	const create = options.createAgentSession ?? createAgentSession;

	return Layer.succeed(AgentSessionClient, {
		prompt: (request) => {
			const log = request.log ?? {};
			return Stream.callback<AgentSessionEvent, AgentSessionClientError>(
				(queue) =>
					Effect.gen(function* () {
						let ended = false;
						const endQueue = () => {
							if (ended) return;
							ended = true;
							Queue.endUnsafe(queue);
						};
						const result = yield* withWideEvent(
							"agent_session.create",
							log,
							Effect.tryPromise({
								try: () => create(request.create),
								catch: (error) => createError("create", error),
							}),
						);
						const session = result.session;
						const unsubscribe = session.subscribe((event) => {
							Queue.offerUnsafe(queue, event);
							if (event.type === "agent_end") endQueue();
						});

						yield* Effect.addFinalizer(() =>
							Effect.sync(() => unsubscribe()).pipe(
								Effect.andThen(disposeSession(session)),
							),
						);

						yield* withFields(
							log,
							withWideEvent(
								"agent_session.prompt",
								log,
								Effect.tryPromise({
									try: () =>
										session.prompt(request.prompt, request.promptOptions),
									catch: (error) => createError("prompt", error),
								}),
							).pipe(
								Effect.tap(() => Effect.sync(endQueue)),
								Effect.catch((error: AgentSessionClientError) =>
									Effect.sync(() =>
										Queue.failCauseUnsafe(queue, Cause.fail(error)),
									),
								),
								Effect.forkScoped,
							),
						);
					}),
			).pipe(
				Stream.tap((event) =>
					logWideEvent(
						{
							operation: "agent_session.event",
							...log,
							...sessionEventFields(event),
						},
						sessionEventLogLevel(event),
					),
				),
			);
		},
	} satisfies AgentSessionClientShape);
};

export const AgentSessionClientLive = makeAgentSessionClientLayer();
