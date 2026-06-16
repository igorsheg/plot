import {
	createAgentSession,
	type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { AsyncQueue } from "@plot/common/async-queue";
import {
	logWideEvent,
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

export type AgentSessionClientErrorPhase = "create" | "prompt" | "dispose";
export class AgentSessionClientError extends Error {
	readonly phase: AgentSessionClientErrorPhase;
	constructor(input: {
		readonly phase: AgentSessionClientErrorPhase;
		readonly message: string;
	}) {
		super(input.message);
		this.name = "AgentSessionClientError";
		this.phase = input.phase;
	}
}
export interface PromptAgentSessionOptions {
	readonly create?: CreateAgentSessionOptions;
	readonly prompt: string;
	readonly promptOptions?: PromptOptions;
	readonly log?: Fields;
	readonly signal?: AbortSignal;
	readonly maxTurns?: number;
	readonly shouldContinue?: (turnNumber: number) => Promise<boolean> | boolean;
	readonly continuationPrompt?: (
		turnNumber: number,
		maxTurns: number,
	) => Promise<string> | string;
}
export interface AgentSessionClientShape {
	readonly prompt: (
		options: PromptAgentSessionOptions,
	) => AsyncIterable<AgentSessionEvent>;
}
export type AgentSessionClient = AgentSessionClientShape;
export const AgentSessionClient = Symbol("AgentSessionClient");
export interface AgentSessionClientLayerOptions {
	readonly createAgentSession?: CreateAgentSession;
}
const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
const createError = (phase: AgentSessionClientErrorPhase, error: unknown) =>
	new AgentSessionClientError({ phase, message: errorMessage(error) });
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
export const makeAgentSessionClientLayer = (
	options: AgentSessionClientLayerOptions = {},
): AgentSessionClientShape => {
	const create = options.createAgentSession ?? createAgentSession;
	return {
		prompt: (request) => ({
			async *[Symbol.asyncIterator]() {
				const log = request.log ?? {};
				const queue = new AsyncQueue<AgentSessionEvent>();
				let session: AgentSession | undefined;
				let unsubscribe: (() => void) | undefined;
				let closed = false;
				const abort = () =>
					queue.fail(
						new AgentSessionClientError({
							phase: session ? "prompt" : "create",
							message: "agent session interrupted",
						}),
					);
				if (request.signal?.aborted) abort();
				request.signal?.addEventListener("abort", abort, { once: true });
				void (async () => {
					try {
						if (request.signal?.aborted) return;
						const result = await withWideEvent(
							"agent_session.create",
							log,
							() => create(request.create),
						);
						session = result.session;
						if (closed || request.signal?.aborted) {
							await disposeSession(session);
							if (request.signal?.aborted) abort();
							return;
						}
						unsubscribe = session.subscribe((event: AgentSessionEvent) => {
							queue.offer(event);
						});
						const maxTurns = request.maxTurns ?? 1;
						if (!Number.isInteger(maxTurns) || maxTurns < 1)
							throw new Error("maxTurns must be a positive integer");
						for (let turnNumber = 1; turnNumber <= maxTurns; turnNumber++) {
							if (request.signal?.aborted) return;
							const prompt =
								turnNumber === 1
									? request.prompt
									: await (request.continuationPrompt?.(turnNumber, maxTurns) ??
											defaultContinuationPrompt(turnNumber, maxTurns));
							await withWideEvent(
								"agent_session.prompt",
								{ ...log, turn_number: turnNumber },
								() => session!.prompt(prompt, request.promptOptions),
							);
							if (turnNumber >= maxTurns) break;
							if (!(await request.shouldContinue?.(turnNumber))) break;
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
								...log,
								...sessionEventFields(event),
							},
							sessionEventLogLevel(event),
						);
						yield event;
					}
				} finally {
					closed = true;
					request.signal?.removeEventListener("abort", abort);
					unsubscribe?.();
					if (session) await disposeSession(session);
				}
			},
		}),
	};
};
export const AgentSessionClientLive = makeAgentSessionClientLayer();
