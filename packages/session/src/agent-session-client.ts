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
				void (async () => {
					try {
						const result = await withWideEvent(
							"agent_session.create",
							log,
							() => create(request.create),
						);
						session = result.session;
						unsubscribe = session.subscribe((event: AgentSessionEvent) => {
							queue.offer(event);
							if (event.type === "agent_end") queue.close();
						});
						await withWideEvent("agent_session.prompt", log, () =>
							session!.prompt(request.prompt, request.promptOptions),
						);
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
					unsubscribe?.();
					if (session) await disposeSession(session);
				}
			},
		}),
	};
};
export const AgentSessionClientLive = makeAgentSessionClientLayer();
