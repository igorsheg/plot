import {
	createAgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	type PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { AsyncQueue } from "@plot/common/async-queue";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type { WorkResult } from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import { Eta } from "eta";

export interface PiAgentSessionPort {
	readonly subscribe: (
		listener: (event: AgentSessionEvent) => void,
	) => () => void;
	readonly prompt: (text: string, options?: PromptOptions) => Promise<void>;
	readonly dispose: () => void;
}

export type CreatePiAgentSession = (
	options?: CreateAgentSessionOptions,
) => Promise<{ readonly session: PiAgentSessionPort }>;

export type PiRunnerValue<A> =
	| A
	| ((context: WorkRunnerContext) => Promise<A> | A);

export interface PiWorkRunnerConfig {
	readonly createAgentSession?: CreatePiAgentSession;
	readonly prompt: PiRunnerValue<string>;
	readonly create?: PiRunnerValue<CreateAgentSessionOptions | undefined>;
	readonly promptOptions?: PiRunnerValue<PromptOptions | undefined>;
	readonly maxTurns?: number;
	readonly eventCapacity?: number;
	readonly onEvent?: (input: {
		readonly context: WorkRunnerContext;
		readonly event: AgentSessionEvent;
	}) => Promise<void> | void;
}

export type PiWorkRunnerErrorPhase = "create" | "prompt" | "event" | "dispose";

export class PiWorkRunnerError extends Error {
	override readonly name = "PiWorkRunnerError";
	readonly phase: PiWorkRunnerErrorPhase;

	constructor(input: {
		readonly phase: PiWorkRunnerErrorPhase;
		readonly message: string;
	}) {
		super(input.message);
		this.phase = input.phase;
	}
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
	const templateContext = context.work.templateContext;
	if (templateContext === undefined) return {};
	return isRecord(templateContext)
		? templateContext
		: { value: templateContext };
};

const renderPrompt = (template: string, context: WorkRunnerContext): string => {
	try {
		return eta.renderString(template, promptData(context));
	} catch (error) {
		throw new PiWorkRunnerError({
			phase: "prompt",
			message: errorMessage(error),
		});
	}
};

const defaultContinuationPrompt = (turnNumber: number, maxTurns: number) => `
Continuation guidance:

- The previous agent turn completed normally, but this work is still active.
- This is continuation turn #${turnNumber} of ${maxTurns} for the current Agent Run.
- Resume from the current workspace and conversation context instead of restarting from scratch.
- Focus on remaining work and do not end the turn while the work stays active unless truly blocked.
`;

const positiveInteger = (value: number, field: string): number => {
	if (Number.isInteger(value) && value >= 1) return value;
	throw new PiWorkRunnerError({
		phase: "prompt",
		message: `${field} must be a positive integer`,
	});
};

const defaultCreateAgentSession: CreatePiAgentSession = async (options) => {
	const result = await createAgentSession(options);
	return { session: result.session };
};

const disposeSession = (session: PiAgentSessionPort): void => {
	try {
		session.dispose();
	} catch (error) {
		throw new PiWorkRunnerError({
			phase: "dispose",
			message: errorMessage(error),
		});
	}
};

async function* promptSession(input: {
	readonly createAgentSession: CreatePiAgentSession;
	readonly create?: CreateAgentSessionOptions;
	readonly prompt: string;
	readonly promptOptions?: PromptOptions;
	readonly signal: AbortSignal;
	readonly maxTurns: number;
	readonly eventCapacity: number;
	readonly shouldContinue?: WorkRunnerContext["shouldContinue"];
}): AsyncIterable<AgentSessionEvent> {
	const queue = new AsyncQueue<AgentSessionEvent>({
		capacity: input.eventCapacity,
		overflow: "reject",
	});
	let session: PiAgentSessionPort | undefined;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;

	const abort = () =>
		queue.fail(
			new PiWorkRunnerError({
				phase: session === undefined ? "create" : "prompt",
				message: "agent session interrupted",
			}),
		);

	if (input.signal.aborted) abort();
	input.signal.addEventListener("abort", abort, { once: true });

	void (async () => {
		try {
			if (input.signal.aborted) return;
			session = (await input.createAgentSession(input.create)).session;
			if (disposed || input.signal.aborted) {
				disposeSession(session);
				return;
			}
			unsubscribe = session.subscribe((event) => {
				if (queue.offer(event)) return;
				queue.fail(
					new PiWorkRunnerError({
						phase: "event",
						message: "agent session event queue is full",
					}),
				);
			});
			for (let turnNumber = 1; turnNumber <= input.maxTurns; turnNumber++) {
				if (input.signal.aborted) return;
				// eslint-disable-next-line no-await-in-loop -- continuation turns are sequential agent prompts.
				await session.prompt(
					turnNumber === 1
						? input.prompt
						: defaultContinuationPrompt(turnNumber, input.maxTurns),
					input.promptOptions,
				);
				if (turnNumber >= input.maxTurns) break;
				// eslint-disable-next-line no-await-in-loop -- continuation policy depends on the completed turn.
				if (!(await input.shouldContinue?.(turnNumber))) break;
			}
			queue.close();
		} catch (error) {
			queue.fail(
				error instanceof PiWorkRunnerError
					? error
					: new PiWorkRunnerError({
							phase: session === undefined ? "create" : "prompt",
							message: errorMessage(error),
						}),
			);
		}
	})();

	try {
		for await (const event of queue) yield event;
	} finally {
		disposed = true;
		input.signal.removeEventListener("abort", abort);
		unsubscribe?.();
		if (session !== undefined) disposeSession(session);
	}
}

export const makePiWorkRunner = (config: PiWorkRunnerConfig): WorkRunner => ({
	run: async (context): Promise<WorkResult> => {
		const promptTemplate = await resolveValue(config.prompt, context);
		const prompt = renderPrompt(promptTemplate, context);
		const create =
			config.create === undefined
				? undefined
				: await resolveValue(config.create, context);
		const promptOptions =
			config.promptOptions === undefined
				? undefined
				: await resolveValue(config.promptOptions, context);
		const maxTurns = positiveInteger(config.maxTurns ?? 20, "maxTurns");
		const eventCapacity = positiveInteger(
			config.eventCapacity ?? 256,
			"eventCapacity",
		);
		let lastActivityPingMs = 0;
		for await (const event of promptSession({
			createAgentSession:
				config.createAgentSession ?? defaultCreateAgentSession,
			...(create === undefined ? {} : { create }),
			prompt,
			...(promptOptions === undefined ? {} : { promptOptions }),
			signal: context.signal,
			maxTurns,
			eventCapacity,
			...(context.shouldContinue === undefined
				? {}
				: { shouldContinue: context.shouldContinue }),
		})) {
			const now = Date.now();
			if (now - lastActivityPingMs >= 10_000) {
				lastActivityPingMs = now;
				await context.emitObservation({ type: "agent_session.activity" });
			}
			await config.onEvent?.({ context, event });
		}
		return {};
	},
});
