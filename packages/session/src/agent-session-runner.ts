import { logWideEvent, withWideEvent } from "@plot/common/observability";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import type { AgentSessionClientShape } from "./agent-session-client.js";
import type {
	AgentSessionEvent,
	CreateAgentSessionOptions,
	PromptOptions,
} from "./agent-session-types.js";
import { renderPromptTemplateForRunnerContext } from "./workflow-template.js";

type RunnerValue<A> = A | ((context: WorkRunnerContext) => Promise<A> | A);
export interface AgentSessionWorkRunnerOptions {
	readonly prompt: RunnerValue<string>;
	readonly create?: RunnerValue<CreateAgentSessionOptions | undefined>;
	readonly promptOptions?: RunnerValue<PromptOptions | undefined>;
	readonly onEvent?: (event: AgentSessionEvent) => Promise<void> | void;
}
const resolve = async <A>(
	value: RunnerValue<A>,
	context: WorkRunnerContext,
): Promise<A> =>
	typeof value === "function"
		? (value as (context: WorkRunnerContext) => Promise<A> | A)(context)
		: value;
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
export const makeAgentSessionWorkRunner = async (
	options: AgentSessionWorkRunnerOptions,
	client: AgentSessionClientShape,
): Promise<WorkRunner> => ({
	run: async (context) =>
		withWideEvent(
			"agent_session.work_runner.run",
			{
				source_id: context.sourceId,
				run_id: context.run.runId,
				work_key: context.work.workKey,
				tick_id: context.tickId,
			},
			async () => {
				const promptTemplate = await resolve(options.prompt, context);
				const prompt = await renderPromptTemplateForRunnerContext(
					promptTemplate,
					context,
				);
				const create =
					options.create === undefined
						? undefined
						: await resolve(options.create, context);
				const promptOptions =
					options.promptOptions === undefined
						? undefined
						: await resolve(options.promptOptions, context);
				for await (const event of client.prompt({
					prompt,
					...(create === undefined ? {} : { create }),
					...(promptOptions === undefined ? {} : { promptOptions }),
					log: {
						source_id: context.sourceId,
						run_id: context.run.runId,
						work_key: context.work.workKey,
						tick_id: context.tickId,
					},
				})) {
					if (options.onEvent) {
						try {
							await options.onEvent(event);
						} catch (error) {
							await logWideEvent(
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
							);
						}
					}
				}
				return {};
			},
		),
});
