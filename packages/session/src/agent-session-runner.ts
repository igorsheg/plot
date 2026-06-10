import { Effect, Stream } from "effect";
import { logWideEvent, withWideEvent } from "@plot/common/observability";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import { AgentSessionClient } from "./agent-session-client.js";
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	PromptOptions,
} from "./agent-session-types.js";
import { renderPromptTemplateForRunnerContext } from "./workflow-template.js";

type RunnerValue<A> =
	| A
	| ((context: WorkRunnerContext) => Effect.Effect<A, unknown>);

export interface AgentSessionWorkRunnerOptions {
	readonly prompt: RunnerValue<string>;
	readonly create?: RunnerValue<CreateAgentSessionOptions | undefined>;
	readonly promptOptions?: RunnerValue<PromptOptions | undefined>;
	readonly onEvent?: (event: AgentSessionEvent) => Effect.Effect<void, unknown>;
}

const resolveRequiredRunnerValue = <A>(
	value: RunnerValue<A>,
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
	value: RunnerValue<A | undefined> | undefined,
	context: WorkRunnerContext,
) => {
	if (value === undefined) return Effect.void;
	return resolveRequiredRunnerValue(value, context);
};

const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

export const makeAgentSessionWorkRunner = (
	options: AgentSessionWorkRunnerOptions,
): Effect.Effect<WorkRunner, never, AgentSessionClient> =>
	Effect.gen(function* () {
		const client = yield* AgentSessionClient;
		return {
			run: (context) =>
				withWideEvent(
					"agent_session.work_runner.run",
					{
						source_id: context.sourceId,
						run_id: context.run.runId,
						work_key: context.work.workKey,
						tick_id: context.tickId,
					},
					Effect.gen(function* () {
						const promptTemplate = yield* resolveRequiredRunnerValue(
							options.prompt,
							context,
						);
						const prompt = yield* renderPromptTemplateForRunnerContext(
							promptTemplate,
							context,
						);
						const create = yield* resolveOptionalRunnerValue(
							options.create,
							context,
						);
						const promptOptions = yield* resolveOptionalRunnerValue(
							options.promptOptions,
							context,
						);
						yield* client
							.prompt({
								prompt,
								...(create === undefined ? {} : { create }),
								...(promptOptions === undefined ? {} : { promptOptions }),
								log: {
									source_id: context.sourceId,
									run_id: context.run.runId,
									work_key: context.work.workKey,
									tick_id: context.tickId,
								},
							})
							.pipe(
								Stream.runForEach((event) =>
									options.onEvent
										? options.onEvent(event).pipe(
												Effect.catch((error) =>
													logWideEvent(
														{
															operation: "agent_session.work_runner.on_event",
															outcome: "error",
															error: errorMessage(error),
															event_type: event.type,
															source_id: context.sourceId,
															run_id: context.run.runId,
															work_key: context.work.workKey,
														},
														"error",
													),
												),
											)
										: Effect.void,
								),
							);
						return {};
					}),
				),
		} satisfies WorkRunner;
	});
