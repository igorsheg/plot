import {
	createAgentSession,
	type AgentSession,
	type AgentSessionEvent,
	type CreateAgentSessionOptions,
	type PromptOptions,
} from "@earendil-works/pi-coding-agent";
import { AsyncQueue } from "@plot/common/async-queue";
import {
	logWideEvent,
	withWideEvent,
	type Fields,
	type WideEventLevel,
} from "@plot/common/observability";
import type { WorkResult } from "@plot/agent/model";
import type { WorkRunner, WorkRunnerContext } from "@plot/agent/work-runner";
import {
	makePromptTemplateData,
	renderPromptTemplate,
} from "../workflow-template.js";
import { errorMessage } from "../util.js";
import type { CreateAgentSession } from "./agent-session.js";

export type PiRunnerValue<A> =
	| A
	| ((context: WorkRunnerContext) => Promise<A> | A);
export interface PiWorkRunnerConfig {
	readonly createAgentSession?: CreateAgentSession;
	readonly prompt: PiRunnerValue<string>;
	readonly create?: PiRunnerValue<CreateAgentSessionOptions | undefined>;
	readonly promptOptions?: PiRunnerValue<PromptOptions | undefined>;
	readonly onEvent?: (input: {
		readonly context: WorkRunnerContext;
		readonly event: AgentSessionEvent;
	}) => Promise<void> | void;
	readonly maxTurns?: number;
}

export type PiWorkRunnerErrorPhase = "create" | "prompt" | "dispose";
export class PiWorkRunnerError extends Error {
	readonly phase: PiWorkRunnerErrorPhase;
	constructor(input: {
		readonly phase: PiWorkRunnerErrorPhase;
		readonly message: string;
	}) {
		super(input.message);
		this.name = "PiWorkRunnerError";
		this.phase = input.phase;
	}
}

const resolveValue = async <A>(
	value: PiRunnerValue<A>,
	context: WorkRunnerContext,
): Promise<A> =>
	typeof value === "function"
		? (value as (context: WorkRunnerContext) => Promise<A> | A)(context)
		: value;

const createError = (phase: PiWorkRunnerErrorPhase, error: unknown) =>
	new PiWorkRunnerError({ phase, message: errorMessage(error) });

const disposeSession = async (session: AgentSession) => {
	try {
		session.dispose();
	} catch (error) {
		await logWideEvent(
			{
				operation: "agent_session.dispose",
				outcome: "error",
				error: errorMessage(error),
			},
			"error",
		);
	}
};

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

const sessionEventLogLevel = (event: AgentSessionEvent): WideEventLevel =>
	event.type === "message_start" ||
	event.type === "message_update" ||
	event.type === "message_end" ||
	event.type === "tool_execution_update"
		? "debug"
		: "info";

const defaultContinuationPrompt = (turnNumber: number, maxTurns: number) => `
Continuation guidance:

- The previous agent turn completed normally, but this work is still active.
- This is continuation turn #${turnNumber} of ${maxTurns} for the current Agent Run.
- Resume from the current workspace and conversation context instead of restarting from scratch.
- The original task instructions and prior turn context are already present in this session.
- Focus on remaining work and do not end the turn while the work stays active unless you are truly blocked.
`;

async function* promptPiSession(input: {
	readonly createAgentSession: CreateAgentSession;
	readonly create?: CreateAgentSessionOptions;
	readonly prompt: string;
	readonly promptOptions?: PromptOptions;
	readonly log: Fields;
	readonly signal?: AbortSignal;
	readonly maxTurns: number;
	readonly shouldContinue?: (turnNumber: number) => Promise<boolean> | boolean;
}): AsyncIterable<AgentSessionEvent> {
	const queue = new AsyncQueue<AgentSessionEvent>();
	let session: AgentSession | undefined;
	let unsubscribe: (() => void) | undefined;
	let closed = false;
	const abort = () =>
		queue.fail(
			new PiWorkRunnerError({
				phase: session ? "prompt" : "create",
				message: "agent session interrupted",
			}),
		);
	if (input.signal?.aborted) abort();
	input.signal?.addEventListener("abort", abort, { once: true });
	void (async () => {
		try {
			if (input.signal?.aborted) return;
			const result = await withWideEvent(
				"agent_session.create",
				input.log,
				() => input.createAgentSession(input.create),
			);
			session = result.session;
			if (closed || input.signal?.aborted) {
				await disposeSession(session);
				if (input.signal?.aborted) abort();
				return;
			}
			unsubscribe = session.subscribe((event: AgentSessionEvent) =>
				queue.offer(event),
			);
			for (let turnNumber = 1; turnNumber <= input.maxTurns; turnNumber++) {
				if (input.signal?.aborted) return;
				const prompt =
					turnNumber === 1
						? input.prompt
						: defaultContinuationPrompt(turnNumber, input.maxTurns);
				await withWideEvent(
					"agent_session.prompt",
					{ ...input.log, turn_number: turnNumber },
					() => session!.prompt(prompt, input.promptOptions),
				);
				if (turnNumber >= input.maxTurns) break;
				if (!(await input.shouldContinue?.(turnNumber))) break;
			}
			queue.close();
		} catch (error) {
			queue.fail(createError(session ? "prompt" : "create", error));
		}
	})();
	try {
		for await (const event of queue) {
			await logWideEvent(
				{
					operation: "agent_session.event",
					...input.log,
					...sessionEventFields(event),
				},
				sessionEventLogLevel(event),
			);
			yield event;
		}
	} finally {
		closed = true;
		input.signal?.removeEventListener("abort", abort);
		unsubscribe?.();
		if (session) await disposeSession(session);
	}
}

export const makePiWorkRunner = (config: PiWorkRunnerConfig): WorkRunner => ({
	run: async (context): Promise<WorkResult> => {
		const promptTemplate = await resolveValue(config.prompt, context);
		const prompt = await renderPromptTemplate(
			promptTemplate,
			makePromptTemplateData(context),
		);
		const create =
			config.create === undefined
				? undefined
				: await resolveValue(config.create, context);
		const promptOptions =
			config.promptOptions === undefined
				? undefined
				: await resolveValue(config.promptOptions, context);
		const maxTurns = config.maxTurns ?? 20;
		if (!Number.isInteger(maxTurns) || maxTurns < 1)
			throw new PiWorkRunnerError({
				phase: "prompt",
				message: "agent.maxTurns must be a positive integer",
			});
		const log = {
			source_id: context.sourceId,
			run_id: context.run.runId,
			work_key: context.work.workKey,
			tick_id: context.tickId,
		};
		let lastActivityPingMs = 0;
		for await (const event of promptPiSession({
			createAgentSession: config.createAgentSession ?? createAgentSession,
			...(create === undefined ? {} : { create }),
			prompt,
			...(promptOptions === undefined ? {} : { promptOptions }),
			log,
			signal: context.signal,
			maxTurns,
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
