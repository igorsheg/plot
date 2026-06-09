import { Effect, Stream } from "effect";
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { AgentSessionClient } from "./llm.js";
import type {
	Observation,
	SourceId,
	RuntimeSnapshot,
	TickId,
	WorkItem,
	WorkResult,
	WorkRun,
} from "./domain.js";

export interface WorkRunnerContext {
	readonly sourceId: SourceId;
	readonly tickId: TickId;
	readonly run: WorkRun;
	readonly work: WorkItem;
	readonly snapshot: RuntimeSnapshot;
	readonly emitObservation: (
		observation: Observation,
	) => Effect.Effect<boolean>;
}

export interface WorkRunner {
	readonly run: (
		context: WorkRunnerContext,
	) => Effect.Effect<WorkResult, unknown>;
}

type RunnerValue<A> =
	| A
	| ((context: WorkRunnerContext) => Effect.Effect<A, unknown>);

export interface AgentSessionWorkRunnerOptions {
	readonly prompt: RunnerValue<string>;
	readonly create?: RunnerValue<CreateAgentSessionOptions | undefined>;
	readonly promptOptions?: RunnerValue<PromptOptions | undefined>;
	readonly onEvent?: (event: AgentSessionEvent) => Effect.Effect<void>;
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
	if (value === undefined) return Effect.succeed(undefined);
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
								options.onEvent ? options.onEvent(event) : Effect.void,
							),
						);
					return {};
				}),
		} satisfies WorkRunner;
	});
