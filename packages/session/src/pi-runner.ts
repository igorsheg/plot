import {
	createAgentSession,
	type AgentSessionEvent,
	type PromptOptions,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { AsyncQueue } from "@plot/common/async-queue";
import { isRecord } from "@plot/common/primitives";
import type { WorkResult } from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import { Eta } from "eta";

export interface PiAgentSessionPort {
	readonly subscribe: (
		listener: (event: AgentSessionEvent) => void,
	) => () => void;
	readonly prompt: (text: string, options?: PromptOptions) => Promise<void>;
	readonly dispose: () => void;
	readonly sessionFile?: string | undefined;
	readonly sessionId?: string | undefined;
}

export const transcriptEventType = "plot_transcript";

export interface PiAgentSessionRunOptions {
	readonly cwd?: string | undefined;
	readonly customTools?: ToolDefinition[] | undefined;
}

export type CreatePiAgentSession = (
	perRun?: PiAgentSessionRunOptions,
) => Promise<{ readonly session: PiAgentSessionPort }>;

export type PiRunnerValue<A> =
	| A
	| ((context: WorkRunnerContext) => Promise<A> | A);

export interface PiWorkRunnerConfig {
	readonly createAgentSession?: CreatePiAgentSession;
	readonly prompt: PiRunnerValue<string>;
	readonly create?: PiRunnerValue<PiAgentSessionRunOptions | undefined>;
	readonly promptOptions?: PiRunnerValue<PromptOptions | undefined>;
	readonly maxTurns?: number;
	readonly eventCapacity?: number;
	readonly onEvent?: (input: {
		readonly context: WorkRunnerContext;
		readonly event: AgentSessionEvent;
	}) => Promise<void> | void;
}

const eta = new Eta({
	tags: ["{{", "}}"],
	parse: { exec: "#", interpolate: "", raw: "~" },
	useWith: true,
	autoEscape: false,
});

const resolveValue = async <A>(
	value: PiRunnerValue<A>,
	context: WorkRunnerContext,
): Promise<A> =>
	typeof value === "function"
		? (value as (context: WorkRunnerContext) => Promise<A> | A)(context)
		: value;

const promptData = (context: WorkRunnerContext): Record<string, unknown> => {
	const data = context.work.templateContext;
	return data === undefined ? {} : isRecord(data) ? data : { value: data };
};

const positive = (value: number, name: string): number => {
	if (!Number.isInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
};

const continuationPrompt = (turn: number, maxTurns: number) => `
Continuation guidance:

- The previous agent turn completed normally, but this work is still active.
- This is continuation turn #${turn} of ${maxTurns} for the current Agent Run.
- Resume from the current workspace and conversation context instead of restarting from scratch.
- Focus on remaining work and do not end the turn while the work stays active unless truly blocked.
`;

const defaultCreateAgentSession: CreatePiAgentSession = async (perRun) => {
	const { session } = await createAgentSession({
		cwd: perRun?.cwd,
		customTools: perRun?.customTools,
	} as Parameters<typeof createAgentSession>[0]);
	return { session };
};

async function* promptSession(input: {
	readonly createAgentSession: CreatePiAgentSession;
	readonly create?: PiAgentSessionRunOptions | undefined;
	readonly prompt: string;
	readonly promptOptions?: PromptOptions | undefined;
	readonly signal: AbortSignal;
	readonly maxTurns: number;
	readonly eventCapacity: number;
	readonly shouldContinue?: WorkRunnerContext["shouldContinue"] | undefined;
}): AsyncIterable<AgentSessionEvent> {
	const queue = new AsyncQueue<AgentSessionEvent>({
		capacity: input.eventCapacity,
		overflow: "reject",
	});
	let session: PiAgentSessionPort | undefined;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;
	const abort = () => queue.fail(new Error("agent session interrupted"));

	if (input.signal.aborted) abort();
	input.signal.addEventListener("abort", abort, { once: true });
	void (async () => {
		try {
			if (input.signal.aborted) return;
			session = (await input.createAgentSession(input.create)).session;
			if (disposed || input.signal.aborted) {
				session.dispose();
				return;
			}
			if (session.sessionFile)
				queue.offer({
					type: transcriptEventType,
					sessionFile: session.sessionFile,
					sessionId: session.sessionId,
				} as unknown as AgentSessionEvent);
			unsubscribe = session.subscribe((event) => {
				if (!queue.offer(event))
					queue.fail(new Error("agent session event queue is full"));
			});
			for (let turn = 1; turn <= input.maxTurns; turn++) {
				if (input.signal.aborted) return;
				// Turns share one conversation and must run in order.
				// eslint-disable-next-line no-await-in-loop
				await session.prompt(
					turn === 1 ? input.prompt : continuationPrompt(turn, input.maxTurns),
					input.promptOptions,
				);
				// eslint-disable-next-line no-await-in-loop
				if (turn === input.maxTurns || !(await input.shouldContinue?.(turn)))
					break;
			}
			queue.close();
		} catch (error) {
			queue.fail(error);
		}
	})();

	try {
		for await (const event of queue) yield event;
	} finally {
		disposed = true;
		input.signal.removeEventListener("abort", abort);
		unsubscribe?.();
		session?.dispose();
	}
}

export const makePiWorkRunner = (config: PiWorkRunnerConfig): WorkRunner => ({
	run: async (context): Promise<WorkResult> => {
		const template = await resolveValue(config.prompt, context);
		const prompt = eta.renderString(template, promptData(context));
		const create = config.create
			? await resolveValue(config.create, context)
			: undefined;
		const promptOptions = config.promptOptions
			? await resolveValue(config.promptOptions, context)
			: undefined;
		for await (const event of promptSession({
			createAgentSession:
				config.createAgentSession ?? defaultCreateAgentSession,
			create,
			prompt,
			promptOptions,
			signal: context.signal,
			maxTurns: positive(config.maxTurns ?? 20, "maxTurns"),
			eventCapacity: positive(config.eventCapacity ?? 256, "eventCapacity"),
			shouldContinue: context.shouldContinue,
		})) {
			context.reportActivity();
			await config.onEvent?.({ context, event });
		}
		return {};
	},
});
