import type {
	AgentSession as PiAgentSession,
	AgentSessionEvent as PiAgentSessionEvent,
	AgentSessionEventListener as PiAgentSessionEventListener,
	CreateAgentSessionOptions as PiCreateAgentSessionOptions,
	CreateAgentSessionResult as PiCreateAgentSessionResult,
	PromptOptions as PiPromptOptions,
} from "@earendil-works/pi-coding-agent";

export type AgentSession = PiAgentSession;
export type AgentSessionEvent = PiAgentSessionEvent;
export type AgentSessionEventListener = PiAgentSessionEventListener;
export type CreateAgentSessionOptions = PiCreateAgentSessionOptions;
export type CreateAgentSessionResult = PiCreateAgentSessionResult;
export type PromptOptions = PiPromptOptions;

export type CreateAgentSession = (
	options?: CreateAgentSessionOptions,
) => Promise<CreateAgentSessionResult>;
