import { Effect, Stream } from "effect";
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import { AgentSessionClient } from "./agent-session-client.js";

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

export const makeAgentSessionWorkRunner = (
	options: AgentSessionWorkRunnerOptions,
): Effect.Effect<WorkRunner, never, AgentSessionClient> =>
	Effect.gen(function* () {
		const client = yield* AgentSessionClient;
		return {
			run: (context) =>
				Effect.gen(function* () {
					const prompt = yield* resolveRequiredRunnerValue(
						options.prompt,
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
									? options.onEvent(event).pipe(Effect.catch(() => Effect.void))
									: Effect.void,
							),
						);
					return {};
				}),
		} satisfies WorkRunner;
	});
